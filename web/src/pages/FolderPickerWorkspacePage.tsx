import { useEffect } from 'react'
import { type ChatContextMeta, type WorkspaceMessage } from '@ai-repo-assistant/shared'

import { ChatPanel } from '../components/ChatPanel'
import { InspectorPanel } from '../components/InspectorPanel'
import { RepositoryPickerPanel } from '../components/RepositoryPickerPanel'
import { WorkspaceSplitLayout } from '../components/WorkspaceSplitLayout'
import { buildChatRequestPayload, sendChatRequest, streamChatRequest } from '../services/chatApi'
import { pickLocalRepository, readSelectedRepoFile } from '../services/localRepoService'
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

export function FolderPickerWorkspacePage() {
  const repoRoot = useWorkspaceStore((state) => state.repoRoot)
  const repoNodes = useWorkspaceStore((state) => state.repoNodes)
  const openFile = useWorkspaceStore((state) => state.openFile)
  const selectedContextPaths = useWorkspaceStore((state) => state.selectedContextPaths)
  const messages = useWorkspaceStore((state) => state.messages)
  const draftMessage = useWorkspaceStore((state) => state.draftMessage)
  const inspectorMode = useWorkspaceStore((state) => state.inspectorMode)
  const diffPreview = useWorkspaceStore((state) => state.diffPreview)
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
  const toggleContextPath = useWorkspaceStore((state) => state.toggleContextPath)
  const setDraftMessage = useWorkspaceStore((state) => state.setDraftMessage)
  const appendUserMessage = useWorkspaceStore((state) => state.appendUserMessage)
  const startSendingMessage = useWorkspaceStore((state) => state.startSendingMessage)
  const beginAssistantStream = useWorkspaceStore((state) => state.beginAssistantStream)
  const appendAssistantStreamChunk = useWorkspaceStore((state) => state.appendAssistantStreamChunk)
  const finishAssistantMessage = useWorkspaceStore((state) => state.finishAssistantMessage)
  const setInspectorMode = useWorkspaceStore((state) => state.setInspectorMode)

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

    // 添加用户消息，清空草稿，标记为发送中状态
    appendUserMessage(nextMessage)
    setDraftMessage('')
    startSendingMessage()
    setErrorMessage(null)

    try {
      // 构建聊天请求负载
      const payload = await buildChatRequestPayload(nextMessage, selectedContextPaths)
      let hasReceivedStreamEvent = false
      let hasCreatedAssistantDraft = false
      let hasCompleted = false

      // 流式处理聊天响应
      await streamChatRequest(payload, {
        onEvent: (event) => {
          hasReceivedStreamEvent = true

          // 处理上下文事件
          if (event.type === 'context') {
            if (!hasCreatedAssistantDraft) {
              beginAssistantStream(event.contextMeta)
              hasCreatedAssistantDraft = true
            }
            return
          }

          // 处理内容块事件
          if (event.type === 'chunk') {
            if (!hasCreatedAssistantDraft) {
              beginAssistantStream(emptyContextMeta)
              hasCreatedAssistantDraft = true
            }
            appendAssistantStreamChunk(event.content)
            return
          }

          // 处理完成事件
          if (event.type === 'done') {
            finishAssistantMessage(event.reply, event.diffPreview ?? null, event.contextMeta)
            hasCompleted = true
            return
          }

          // 未知事件类型，抛出错误
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
        const payload = await buildChatRequestPayload(nextMessage, selectedContextPaths)
        const fallback = await sendChatRequest(payload)
        finishAssistantMessage(fallback.reply, fallback.diffPreview ?? null, fallback.contextMeta)
      } catch (fallbackError) {
        // 备用请求也失败，使用降级消息
        const finalError = buildErrorMessage(fallbackError)
        finishAssistantMessage(
          createFallbackAssistantMessage(`The assistant request failed. ${primaryError}. Fallback also failed: ${finalError}`),
          null,
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
              diffPreview={diffPreview}
              onModeChange={setInspectorMode}
            />
          }
        />
      </main>
    </div>
  )
}