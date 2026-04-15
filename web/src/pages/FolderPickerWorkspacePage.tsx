import { useEffect } from 'react'
import { type ChatContextMeta, type PendingSuggestion, type WorkspaceMessage } from '@ai-repo-assistant/shared'

import { ChatPanel } from '../components/ChatPanel'
import { InspectorPanel } from '../components/InspectorPanel'
import { RepositoryPickerPanel } from '../components/RepositoryPickerPanel'
import { WorkspaceSplitLayout } from '../components/WorkspaceSplitLayout'
import { buildChatRequestPayload, sendChatRequest, streamChatRequest } from '../services/chatApi'
import { pickLocalRepository, readSelectedRepoFile, writeSelectedRepoFile } from '../services/localRepoService'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

function buildErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error while talking to the local server.'
}
// 兜底处理，确保用户在请求失败时至少能看到一个错误消息，而不是完全没有反馈
function createFallbackAssistantMessage(message: string): WorkspaceMessage {
  return {
    id: `assistant-error-${Date.now()}`,
    role: 'assistant',
    content: message,
    createdAt: new Date().toISOString(),
  }
}
//空的上下文元数
const emptyContextMeta: ChatContextMeta = {
  usedContextPaths: [],
  truncatedPaths: [],
  totalCharacters: 0,
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

export function FolderPickerWorkspacePage() {
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
  const lastContextMeta = useWorkspaceStore((state) => state.lastContextMeta)
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
  const clearDiffPreview = useWorkspaceStore((state) => state.clearDiffPreview)
  const removeSuggestionAt = useWorkspaceStore((state) => state.removeSuggestionAt)
  const setActiveSuggestionIndex = useWorkspaceStore((state) => state.setActiveSuggestionIndex)

  // 处理应用建议的函数，接收建议的索引和建议对象
  const handleApplySuggestion = async (index: number, suggestion: PendingSuggestion) => {
    try {
      // 将建议的更新内容写入目标文件
      const updatedFile = await writeSelectedRepoFile(suggestion.targetPath, suggestion.updatedContent)

      // 如果打开的文件路径与更新的文件路径匹配，则更新编辑器中的文件内容
      if (openFile?.path === updatedFile.path || openFile?.path === suggestion.targetPath) {
        replaceOpenFileContent(updatedFile)
      }

      // 从待处理建议列表中移除该建议
      removeSuggestionAt(index)
      // 添加系统消息表示修改已应用
      appendAssistantMessage(`[系统] 已应用 ${updatedFile.path} 的修改`)
    } catch (error) {
      // 捕获错误并设置错误消息
      setErrorMessage(error instanceof Error ? error.message : '应用修改失败')
    }
  }

  // 处理丢弃建议的函数，接收建议的索引
  const handleDiscardSuggestion = (index: number) => {
    // 从待处理建议列表中移除该建议
    removeSuggestionAt(index)
  }

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

  async function handleSendMessage() {
    // 获取并修剪用户输入的消息
    const nextMessage = draftMessage.trim()

    // 如果消息为空或正在发送消息，则返回
    if (!nextMessage || isSendingMessage) {
      return
    }

    const recentHistory = buildRecentHistory(messages)

    appendUserMessage(nextMessage)
    setDraftMessage('')
    startSendingMessage()
    setErrorMessage(null)

    try {
      const payload = await buildChatRequestPayload(nextMessage, selectedContextPaths, recentHistory)
      let hasCreatedAssistantDraft = false
      let hasCompleted = false

      // 流式处理聊天响应
      await streamChatRequest(payload, {
        onEvent: (event) => {
          if (event.type === 'context') {
            if (!hasCreatedAssistantDraft) {
              beginAssistantStream(event.contextMeta)
              hasCreatedAssistantDraft = true
            }
            return
          }

          if (event.type === 'chunk') {
            if (!hasCreatedAssistantDraft) {
              beginAssistantStream(emptyContextMeta)
              hasCreatedAssistantDraft = true
            }

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

      // 验证流是否正确完成
      if (!hasCompleted) {
        throw new Error('The stream ended before a final assistant message was received.')
      }
    } catch (error) {
      // 主请求失败，尝试备用请求
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
          createFallbackAssistantMessage(`The assistant request failed. ${primaryError}. Fallback also failed: ${finalError}`),
          [],
          [],
          emptyContextMeta,
        )
        setErrorMessage(finalError)
      }
    }
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <div>
          <p className="workspace-topbar__eyebrow">AI REPO ASSISTANT</p>
          <h1>Web MVP for a repo-level coding assistant</h1>
          <p className="workspace-topbar__summary">
            This version uses a local folder picker instead of manual path input. The left column shows the repository tree,
            the center column handles chat, and the right column previews source code or diff output.
          </p>
        </div>
        <div className="workspace-topbar__meta">
          <span className={`status-pill status-pill--${serverStatus}`}>{serverStatus}</span>
          <span className="meta-card">{selectedContextPaths.length} context file(s)</span>
          <span className="meta-card">{repoRoot || 'No repository loaded'}</span>
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
              lastContextMeta={lastContextMeta}
              isSendingMessage={isSendingMessage}
              onDraftChange={setDraftMessage}
              onSend={handleSendMessage}
            />
          }
          right={
            <InspectorPanel
              openFile={openFile}
              inspectorMode={inspectorMode}
              diffPreviews={diffPreviews}
              pendingSuggestions={pendingSuggestions}
              activeSuggestionIndex={activeSuggestionIndex}
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
