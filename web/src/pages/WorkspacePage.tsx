import { useEffect } from 'react'
import {
  chatResponseSchema,
  repoFileResponseSchema,
  repoTreeResponseSchema,
  type RepoNode,
  type WorkspaceMessage,
} from '@ai-repo-assistant/shared'

import { ChatPanel } from '../components/ChatPanel'
import { FileTreePanel } from '../components/FileTreePanel'
import { InspectorPanel } from '../components/InspectorPanel'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { c } from 'node_modules/vite/dist/node/types.d-aGj9QkWt'

// 一个小工具函数：请求接口并把 JSON 解析出来。
// 后面你如果接更多接口，通常也会继续复用这个思路。
async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return (await response.json()) as T
}

// 找文件树里的第一个文件，让页面首次打开时右侧不至于空白。
function findFirstFilePath(nodes: RepoNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node.path
    }

    if (node.children?.length) {
      const nestedMatch = findFirstFilePath(node.children)
      if (nestedMatch) {
        return nestedMatch
      }
    }
  }

  return null
}

function buildErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unexpected error while talking to the local mock server.'
}

export function WorkspacePage() {
  // UI 状态：仓库结构与文件内容
  const repoRoot = useWorkspaceStore((state) => state.repoRoot)
  const repoNodes = useWorkspaceStore((state) => state.repoNodes)
  const openFile = useWorkspaceStore((state) => state.openFile)
  const selectedContextPaths = useWorkspaceStore((state) => state.selectedContextPaths)

  // 聊天相关状态
  const messages = useWorkspaceStore((state) => state.messages)
  const draftMessage = useWorkspaceStore((state) => state.draftMessage)
  const isSendingMessage = useWorkspaceStore((state) => state.isSendingMessage)

  // 代码检查与预览状态
  const inspectorMode = useWorkspaceStore((state) => state.inspectorMode)
  const diffPreview = useWorkspaceStore((state) => state.diffPreview)

  // 系统状态
  const isBootstrapping = useWorkspaceStore((state) => state.isBootstrapping)
  const serverStatus = useWorkspaceStore((state) => state.serverStatus)
  const errorMessage = useWorkspaceStore((state) => state.errorMessage)

  // 状态更新方法
  const setBootstrapping = useWorkspaceStore((state) => state.setBootstrapping)
  const setServerStatus = useWorkspaceStore((state) => state.setServerStatus)
  const setErrorMessage = useWorkspaceStore((state) => state.setErrorMessage)

  // 业务逻辑方法
  const bootstrapWorkspace = useWorkspaceStore((state) => state.bootstrapWorkspace)
  const openFilePreview = useWorkspaceStore((state) => state.openFilePreview)
  const toggleContextPath = useWorkspaceStore((state) => state.toggleContextPath)
  const setDraftMessage = useWorkspaceStore((state) => state.setDraftMessage)
  const appendUserMessage = useWorkspaceStore((state) => state.appendUserMessage)
  const startSendingMessage = useWorkspaceStore((state) => state.startSendingMessage)
  const finishAssistantMessage = useWorkspaceStore((state) => state.finishAssistantMessage)
  const setInspectorMode = useWorkspaceStore((state) => state.setInspectorMode)

  useEffect(() => {
    // 页面首次进入时：先探活后端，再拉文件树，再默认打开第一个文件。
    let cancelled = false

    async function bootstrap() {
      setBootstrapping(true)
      setServerStatus('checking')
      setErrorMessage(null)

      try {
        await readJson('/api/health')
        const treePayload = repoTreeResponseSchema.parse(await readJson('/api/repo/tree'))
        const firstFilePath = findFirstFilePath(treePayload.nodes)

        const openFile = firstFilePath
          ? repoFileResponseSchema.parse(
            await readJson(`/api/repo/file?path=${encodeURIComponent(firstFilePath)}`),
          ).file
          : null

        if (cancelled) {
          return
        }

        bootstrapWorkspace({
          root: treePayload.root,
          nodes: treePayload.nodes,
          openFile,
        })
        setServerStatus('online')
      } catch (error) {
        if (cancelled) {
          return
        }

        setServerStatus('offline')
        setErrorMessage(buildErrorMessage(error))
      } finally {
        if (!cancelled) {
          setBootstrapping(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [bootstrapWorkspace, setBootstrapping, setErrorMessage, setServerStatus])

  async function handleOpenFile(path: string) {
    try {
      setErrorMessage(null)
      const payload = repoFileResponseSchema.parse(await readJson(`/api/repo/file?path=${encodeURIComponent(path)}`))
      openFilePreview(payload.file)
    } catch (error) {
      setErrorMessage(buildErrorMessage(error))
    }
  }

  async function handleSendMessage() {
    // 发送消息的顺序是：先把用户消息写进本地 UI，再请求后端拿助手回复。
    const nextMessage = draftMessage.trim()

    if (!nextMessage || isSendingMessage) {
      return
    }

    appendUserMessage(nextMessage)
    setDraftMessage('')
    startSendingMessage()

    try {
      const payload = chatResponseSchema.parse(
        await readJson('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: nextMessage,
            selectedPaths: selectedContextPaths,
          }),
        }),
      )

      finishAssistantMessage(payload.reply, payload.diffPreview ?? null)
    } catch (error) {
      const fallbackMessage: WorkspaceMessage = {
        id: `assistant-error-${Date.now()}`,
        role: 'assistant',
        content: `The mock assistant could not answer because the request failed. ${buildErrorMessage(error)}`,
        createdAt: new Date().toISOString(),
      }

      finishAssistantMessage(fallbackMessage, null)
      setErrorMessage(buildErrorMessage(error))
    }
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <div>
          <p className="workspace-topbar__eyebrow">AI 代码仓库助手</p>
          <h1>仓库级编程助手的网页 MVP 原型</h1>
          <p className="workspace-topbar__summary">
            第一阶段采用 Claude Code 的架构设计：共享契约层、后端协调层，以及分离展示仓库上下文、对话和代码检查的前端界面。
          </p>
        </div>
        <div className="workspace-topbar__meta">
          <span className={`status-pill status-pill--${serverStatus}`}>{serverStatus}</span>
          <span className="meta-card">{selectedContextPaths.length} 个上下文文件</span>
          <span className="meta-card">{repoRoot || '无仓库加载'}</span>
        </div>
      </header>

      {errorMessage ? <div className="workspace-alert">{errorMessage}</div> : null}

      {/* 三栏布局：左边仓库，中间聊天，右边代码 / diff 检查。 */}
      <main className="workspace-grid">
        <FileTreePanel
          repoRoot={repoRoot}
          nodes={repoNodes}
          activePath={openFile?.path ?? null}
          selectedContextPaths={selectedContextPaths}
          serverStatus={serverStatus}
          isBootstrapping={isBootstrapping}
          onOpenFile={handleOpenFile}
          onToggleContext={toggleContextPath}
        />
        <ChatPanel
          messages={messages}
          draftMessage={draftMessage}
          selectedContextPaths={selectedContextPaths}
          isSendingMessage={isSendingMessage}
          onDraftChange={setDraftMessage}
          onSend={handleSendMessage}
        />
        <InspectorPanel
          openFile={openFile}
          inspectorMode={inspectorMode}
          diffPreview={diffPreview}
          onModeChange={setInspectorMode}
        />
      </main>
    </div>
  )
}
