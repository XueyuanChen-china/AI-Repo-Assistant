import { useEffect, useState } from 'react'
import { type PendingSuggestion, type WorkspaceMessage } from '@ai-repo-assistant/shared'

import { ChatPanel } from '../components/ChatPanel'
import { InspectorPanel } from '../components/InspectorPanel'
import { RepositoryPickerPanel } from '../components/RepositoryPickerPanel'
import { WorkspaceSplitLayout } from '../components/WorkspaceSplitLayout'
import { buildChatRequestPayload, sendChatRequest, streamChatRequest } from '../services/chatApi'
import {
  isFolderPickerAbortError,
  pickLocalRepository,
  readSelectedRepoFile,
  writeSelectedRepoFile,
} from '../services/localRepoService'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `请求失败，状态码：${response.status}`)
  }

  return (await response.json()) as T
}

function buildErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return '与本地服务通信时发生未知错误。'
  }

  const message = error.message

  if (message === 'FOLDER_PICKER_ABORTED') {
    return ''
  }

  if (message.includes('The current folder selection mode is read-only')) {
    return '当前文件夹处于只读模式。请使用浏览器原生文件夹选择器重新打开，以允许写入文件。'
  }

  if (message.includes('The selected file could not be found in memory')) {
    return '当前文件句柄已失效，请重新打开项目文件夹。'
  }

  if (message.includes('File is too large')) {
    return '文件过大，当前版本仅支持预览 256KB 以内的文件。'
  }

  if (message.includes('The stream ended before a final assistant message was received.')) {
    return '流式响应在收到最终结果前就结束了。'
  }

  return message
}

function createFallbackAssistantMessage(message: string): WorkspaceMessage {
  return {
    id: `assistant-error-${Date.now()}`,
    role: 'assistant',
    content: message,
    createdAt: new Date().toISOString(),
  }
}

function isUsefulHistoryMessage(message: WorkspaceMessage) {
  if (message.id === 'assistant-welcome') {
    return false
  }

  if (!message.content.trim()) {
    return false
  }

  if (message.content.startsWith('[系统]')) {
    return false
  }

  if (message.id.startsWith('assistant-error-')) {
    return false
  }

  return true
}

function buildRecentHistory(messages: WorkspaceMessage[]) {
  return messages.filter(isUsefulHistoryMessage).slice(-6)
}

function getServerStatusLabel(serverStatus: string) {
  if (serverStatus === 'online') {
    return '在线'
  }

  if (serverStatus === 'offline') {
    return '离线'
  }

  return '检查中'
}

export function FolderPickerWorkspacePage() {
  const [applyingSuggestionIndex, setApplyingSuggestionIndex] = useState<number | null>(null)

  const repoRoot = useWorkspaceStore((state) => state.repoRoot)
  const repoNodes = useWorkspaceStore((state) => state.repoNodes)
  const openFile = useWorkspaceStore((state) => state.openFile)
  const selectedContextPaths = useWorkspaceStore((state) => state.selectedContextPaths)
  const messages = useWorkspaceStore((state) => state.messages)
  const draftMessage = useWorkspaceStore((state) => state.draftMessage)
  const inspectorMode = useWorkspaceStore((state) => state.inspectorMode)
  const diffPreviews = useWorkspaceStore((state) => state.diffPreviews)
  const pendingSuggestions = useWorkspaceStore((state) => state.pendingSuggestions)
  const activeSuggestionIndex = useWorkspaceStore((state) => state.activeSuggestionIndex)
  const isBootstrapping = useWorkspaceStore((state) => state.isBootstrapping)
  const isSendingMessage = useWorkspaceStore((state) => state.isSendingMessage)
  const serverStatus = useWorkspaceStore((state) => state.serverStatus)
  const errorMessage = useWorkspaceStore((state) => state.errorMessage)
  const setBootstrapping = useWorkspaceStore((state) => state.setBootstrapping)
  const setServerStatus = useWorkspaceStore((state) => state.setServerStatus)
  const setErrorMessage = useWorkspaceStore((state) => state.setErrorMessage)
  const bootstrapWorkspace = useWorkspaceStore((state) => state.bootstrapWorkspace)
  const openFilePreview = useWorkspaceStore((state) => state.openFilePreview)
  const replaceOpenFileContent = useWorkspaceStore((state) => state.replaceOpenFileContent)
  const toggleContextPath = useWorkspaceStore((state) => state.toggleContextPath)
  const setDraftMessage = useWorkspaceStore((state) => state.setDraftMessage)
  const appendUserMessage = useWorkspaceStore((state) => state.appendUserMessage)
  const appendAssistantMessage = useWorkspaceStore((state) => state.appendAssistantMessage)
  const startSendingMessage = useWorkspaceStore((state) => state.startSendingMessage)
  const beginAssistantStream = useWorkspaceStore((state) => state.beginAssistantStream)
  const appendAssistantStreamChunk = useWorkspaceStore((state) => state.appendAssistantStreamChunk)
  const finishAssistantMessage = useWorkspaceStore((state) => state.finishAssistantMessage)
  const setInspectorMode = useWorkspaceStore((state) => state.setInspectorMode)
  const setActiveSuggestionIndex = useWorkspaceStore((state) => state.setActiveSuggestionIndex)
  const removeSuggestionAt = useWorkspaceStore((state) => state.removeSuggestionAt)

  useEffect(() => {
    let cancelled = false

    async function bootstrapServerStatus() {
      setServerStatus('checking')

      try {
        await readJson('/api/health')

        if (!cancelled) {
          setServerStatus('online')
        }
      } catch (error) {
        if (!cancelled) {
          setServerStatus('offline')
          setErrorMessage(buildErrorMessage(error))
        }
      }
    }

    void bootstrapServerStatus()

    return () => {
      cancelled = true
    }
  }, [setErrorMessage, setServerStatus])

  async function handlePickFolder() {
    setBootstrapping(true)
    setErrorMessage(null)

    try {
      const snapshot = await pickLocalRepository()
      bootstrapWorkspace(snapshot)
    } catch (error) {
      if (isFolderPickerAbortError(error)) {
        return
      }

      setErrorMessage(buildErrorMessage(error))
    } finally {
      setBootstrapping(false)
    }
  }

  async function handleOpenFile(path: string) {
    try {
      setErrorMessage(null)
      const file = await readSelectedRepoFile(path)
      openFilePreview(file)
    } catch (error) {
      setErrorMessage(buildErrorMessage(error))
    }
  }

  async function handleApplySuggestion(index: number, suggestion: PendingSuggestion) {
    setApplyingSuggestionIndex(index)
    setErrorMessage(null)

    try {
      const updatedFile = await writeSelectedRepoFile(suggestion.targetPath, suggestion.updatedContent)

      if (openFile?.path === updatedFile.path || openFile?.path === suggestion.targetPath) {
        replaceOpenFileContent(updatedFile)
      }

      removeSuggestionAt(index)
      appendAssistantMessage(`[系统] 已应用 ${updatedFile.path} 的修改`)
    } catch (error) {
      setErrorMessage(buildErrorMessage(error))
    } finally {
      setApplyingSuggestionIndex(null)
    }
  }

  function handleDiscardSuggestion(index: number) {
    if (applyingSuggestionIndex !== null) {
      return
    }

    removeSuggestionAt(index)
  }

  async function handleSendMessage() {
    const nextMessage = draftMessage.trim()

    if (!nextMessage || isSendingMessage) {
      return
    }

    if (!repoRoot || repoNodes.length === 0) {
      setErrorMessage('请先打开本地项目文件夹，再开始提问或请求代码修改建议。')
      return
    }

    const recentHistory = buildRecentHistory(messages)

    appendUserMessage(nextMessage)
    setDraftMessage('')
    startSendingMessage()
    setErrorMessage(null)

    try {
      const payload = await buildChatRequestPayload(nextMessage, selectedContextPaths, recentHistory)
      let hasCompleted = false

      await streamChatRequest(payload, {
        onEvent: (event) => {
          if (event.type === 'context') {
            beginAssistantStream(event.contextMeta)
            return
          }

          if (event.type === 'chunk') {
            appendAssistantStreamChunk(event.content)
            return
          }

          if (event.type === 'done') {
            finishAssistantMessage(
              event.reply,
              event.diffPreviews,
              event.pendingSuggestions,
              event.contextMeta,
            )
            hasCompleted = true
            return
          }

          throw new Error(event.message)
        },
      })

      if (!hasCompleted) {
        throw new Error('The stream ended before a final assistant message was received.')
      }
    } catch (error) {
      const primaryError = buildErrorMessage(error)

      try {
        const payload = await buildChatRequestPayload(nextMessage, selectedContextPaths, recentHistory)
        const fallback = await sendChatRequest(payload)
        finishAssistantMessage(
          fallback.reply,
          fallback.diffPreviews,
          fallback.pendingSuggestions,
          fallback.contextMeta,
        )
      } catch (fallbackError) {
        const finalError = buildErrorMessage(fallbackError)
        finishAssistantMessage(
          createFallbackAssistantMessage(`助手请求失败：${primaryError}。备用请求也失败了：${finalError}`),
          [],
          [],
          null,
        )
        setErrorMessage(finalError)
      }
    }
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-topbar__title">
          <p className="workspace-topbar__eyebrow">AI 仓库助手</p>
          <h1>仓库级代码工作台</h1>
        </div>
        <div className="workspace-topbar__meta">
          <span className={`status-pill status-pill--${serverStatus}`}>{getServerStatusLabel(serverStatus)}</span>
          <span className="meta-card">{selectedContextPaths.length} 个上下文文件</span>
          <span className="meta-card meta-card--path">{repoRoot || '未打开仓库'}</span>
        </div>
      </header>

      {errorMessage ? <div className="workspace-alert">{errorMessage}</div> : null}

      <main className="workspace-main">
        <WorkspaceSplitLayout
          left={
            <RepositoryPickerPanel
              repoRoot={repoRoot}
              nodes={repoNodes}
              activePath={openFile?.path ?? null}
              selectedContextPaths={selectedContextPaths}
              serverStatus={serverStatus}
              isBootstrapping={isBootstrapping}
              onPickFolder={handlePickFolder}
              onOpenFile={handleOpenFile}
              onToggleContext={toggleContextPath}
            />
          }
          center={
            <ChatPanel
              messages={messages}
              draftMessage={draftMessage}
              selectedContextPaths={selectedContextPaths}
              isSendingMessage={isSendingMessage}
              onDraftChange={setDraftMessage}
              onSend={handleSendMessage}
              onRemoveContext={toggleContextPath}
            />
          }
          right={
            <InspectorPanel
              openFile={openFile}
              inspectorMode={inspectorMode}
              diffPreviews={diffPreviews}
              pendingSuggestions={pendingSuggestions}
              activeSuggestionIndex={activeSuggestionIndex}
              applyingSuggestionIndex={applyingSuggestionIndex}
              onModeChange={setInspectorMode}
              onActiveSuggestionChange={setActiveSuggestionIndex}
              onApplySuggestion={handleApplySuggestion}
              onDiscardSuggestion={handleDiscardSuggestion}
            />
          }
        />
      </main>
    </div>
  )
}
