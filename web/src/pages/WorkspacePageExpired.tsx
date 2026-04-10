import { useEffect } from 'react'
import {
  chatResponseSchema,
  healthResponseSchema,
  repoFileResponseSchema,
  repoTreeResponseSchema,
  type RepoNode,
  type WorkspaceMessage,
} from '@ai-repo-assistant/shared'

import { ChatPanel } from '../components/ChatPanel'
import { FileTreePanel } from '../components/FileTreePanelExpired1'
import { InspectorPanel } from '../components/InspectorPanel'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

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

  return 'Unexpected error while talking to the local server.'
}

function buildRepoTreeUrl(rootPath?: string) {
  if (!rootPath) {
    return '/api/repo/tree'
  }

  return `/api/repo/tree?root=${encodeURIComponent(rootPath)}`
}

function buildRepoFileUrl(rootPath: string, filePath: string) {
  const encodedRoot = encodeURIComponent(rootPath)
  const encodedPath = encodeURIComponent(filePath)
  return `/api/repo/file?root=${encodedRoot}&path=${encodedPath}`
}

export function WorkspacePage() {
  // UI 状态：仓库结构与文件内容
  const repoRoot = useWorkspaceStore((state) => state.repoRoot)
  const repoRootInput = useWorkspaceStore((state) => state.repoRootInput)
  const repoNodes = useWorkspaceStore((state) => state.repoNodes)
  const openFile = useWorkspaceStore((state) => state.openFile)
  const selectedContextPaths = useWorkspaceStore((state) => state.selectedContextPaths)

  // 聊天相关状态
  const messages = useWorkspaceStore((state) => state.messages)
  const draftMessage = useWorkspaceStore((state) => state.draftMessage)
  const inspectorMode = useWorkspaceStore((state) => state.inspectorMode)
  const diffPreview = useWorkspaceStore((state) => state.diffPreview)

  // 系统状态
  const isBootstrapping = useWorkspaceStore((state) => state.isBootstrapping)
  const isSendingMessage = useWorkspaceStore((state) => state.isSendingMessage)
  const serverStatus = useWorkspaceStore((state) => state.serverStatus)
  const errorMessage = useWorkspaceStore((state) => state.errorMessage)

  // 状态更新方法
  const setBootstrapping = useWorkspaceStore((state) => state.setBootstrapping)
  const setServerStatus = useWorkspaceStore((state) => state.setServerStatus)
  const setErrorMessage = useWorkspaceStore((state) => state.setErrorMessage)
  const setRepoRootInput = useWorkspaceStore((state) => state.setRepoRootInput)
  const bootstrapWorkspace = useWorkspaceStore((state) => state.bootstrapWorkspace)
  const openFilePreview = useWorkspaceStore((state) => state.openFilePreview)
  const toggleContextPath = useWorkspaceStore((state) => state.toggleContextPath)
  const setDraftMessage = useWorkspaceStore((state) => state.setDraftMessage)
  const appendUserMessage = useWorkspaceStore((state) => state.appendUserMessage)
  const startSendingMessage = useWorkspaceStore((state) => state.startSendingMessage)
  const finishAssistantMessage = useWorkspaceStore((state) => state.finishAssistantMessage)
  const setInspectorMode = useWorkspaceStore((state) => state.setInspectorMode)

  async function loadWorkspace(nextRootCandidate?: string) {
    setBootstrapping(true)
    setServerStatus('checking')
    setErrorMessage(null)

    try {
      //检测服务器状态，返回包含suggestedRoot字段的响应。
      const healthPayload = healthResponseSchema.parse(await readJson('/api/health'))
      // 决定要加载哪个仓库：优先使用函数参数里传入的路径（用户在输入框里填的），其次是当前状态里的 repoRootInput，再次是服务器建议的路径。
      const requestedRoot = nextRootCandidate?.trim() || repoRootInput.trim() || healthPayload.suggestedRoot
      //请求仓库树接口，拿到文件树数据。
      const treePayload = repoTreeResponseSchema.parse(await readJson(buildRepoTreeUrl(requestedRoot)))
      //
      const firstFilePath = findFirstFilePath(treePayload.nodes)

      const openFile = firstFilePath
        ? repoFileResponseSchema.parse(await readJson(buildRepoFileUrl(treePayload.root, firstFilePath))).file
        : null

      bootstrapWorkspace({
        root: treePayload.root,
        nodes: treePayload.nodes,
        openFile,
      })
      setServerStatus('online')
    } catch (error) {
      setServerStatus('offline')
      setErrorMessage(buildErrorMessage(error))
    } finally {
      setBootstrapping(false)
    }
  }

  useEffect(() => {
    // Bootstrap once on page load: ping the server, then load the default repo.
    void loadWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleOpenFile(path: string) {
    if (!repoRoot) {
      return
    }

    try {
      setErrorMessage(null)
      const payload = repoFileResponseSchema.parse(await readJson(buildRepoFileUrl(repoRoot, path)))
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
        content: `The assistant could not answer because the request failed. ${buildErrorMessage(error)}`,
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
          repoRootInput={repoRootInput}
          nodes={repoNodes}
          activePath={openFile?.path ?? null}
          selectedContextPaths={selectedContextPaths}
          serverStatus={serverStatus}
          isBootstrapping={isBootstrapping}
          onRepoRootInputChange={setRepoRootInput}
          onReloadRepo={() => void loadWorkspace(repoRootInput)}
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