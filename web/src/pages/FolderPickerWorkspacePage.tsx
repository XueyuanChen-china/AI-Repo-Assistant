import { useEffect, useState } from 'react'
import { type PendingSuggestion, type WorkspaceMessage } from '@ai-repo-assistant/shared'

import { ChatPanel } from '../components/ChatPanel'
import { InspectorPanel } from '../components/InspectorPanel'
import { RepositoryPickerPanel } from '../components/RepositoryPickerPanel'
import { WorkspaceSplitLayout } from '../components/WorkspaceSplitLayout'
import { withApiBase } from '../services/apiBase'
import { buildChatRequestPayload, sendChatRequest, streamChatRequest } from '../services/chatApi'
import {
  isFolderPickerAbortError,
  pickLocalRepository,
  readSelectedRepoFile,
  writeSelectedRepoFile,
} from '../services/localRepoService'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * 通用 JSON 读取函数
 * @param input 请求地址
 * @param init 请求配置
 * @returns 解析后的 JSON 数据
 */
async function readJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `请求失败，状态码：${response.status}`)
  }

  return (await response.json()) as T
}

/**
 * 构建用户友好的错误信息
 * @param error 原始错误对象
 * @returns 格式化后的错误消息字符串
 */
function buildErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return '与本地服务通信时发生未知错误。'
  }

  const message = error.message

  // 文件夹选择被中止，无需显示错误信息
  if (message === 'FOLDER_PICKER_ABORTED') {
    return ''
  }

  // 文件夹处于只读模式
  if (message.includes('The current folder selection mode is read-only')) {
    return '当前文件夹处于只读模式。请使用浏览器原生文件夹选择器重新打开，以允许写入文件。'
  }

  // 文件句柄失效
  if (message.includes('The selected file could not be found in memory')) {
    return '当前文件句柄已失效，请重新打开项目文件夹。'
  }

  // 文件过大
  if (message.includes('File is too large')) {
    return '文件过大，当前版本仅支持预览 256KB 以内的文件。'
  }

  // 流式响应中断
  if (message.includes('The stream ended before a final assistant message was received.')) {
    return '流式响应在收到最终结果前就结束了。'
  }

  return message
}

/**
 * 创建一条失败的助手消息
 * @param message 错误消息内容
 * @returns 工作区消息对象
 */
function createFallbackAssistantMessage(message: string): WorkspaceMessage {
  return {
    id: `assistant-error-${Date.now()}`,
    role: 'assistant',
    content: message,
    createdAt: new Date().toISOString(),
  }
}

/**
 * 判断消息是否有用（用于历史记录过滤）
 * @param message 工作区消息
 * @returns 是否应该保留该消息
 */
function isUsefulHistoryMessage(message: WorkspaceMessage) {
  // 排除欢迎消息
  if (message.id === 'assistant-welcome') {
    return false
  }

  // 排除空消息
  if (!message.content.trim()) {
    return false
  }

  // 排除系统消息
  if (message.content.startsWith('[系统]')) {
    return false
  }

  // 排除错误消息
  if (message.id.startsWith('assistant-error-')) {
    return false
  }

  return true
}

/**
 * 构建最近的有用消息历史记录（最多 6 条）
 * @param messages 所有消息列表
 * @returns 过滤后的消息数组
 */
function buildRecentHistory(messages: WorkspaceMessage[]) {
  return messages.filter(isUsefulHistoryMessage).slice(-6)
}

/**
 * 转换服务器状态为中文标签
 * @param serverStatus 服务器状态值
 * @returns 对应的中文标签
 */
function getServerStatusLabel(serverStatus: string) {
  if (serverStatus === 'online') {
    return '在线'
  }

  if (serverStatus === 'offline') {
    return '离线'
  }

  return '检查中'
}

/**
 * 文件夹选择工作区页面组件
 * 主要功能：
 * - 管理本地仓库的选择和文件浏览
 * - 处理用户与 AI 助手的对话交互
 * - 管理代码建议的查看和应用
 * - 监控服务器连接状态
 */
export function FolderPickerWorkspacePage() {
  // 当前正在应用的建议索引
  const [applyingSuggestionIndex, setApplyingSuggestionIndex] = useState<number | null>(null)

  // ============ 工作区状态 ============
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

  // ============ 状态更新方法 ============
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

  /**
   * 组件挂载时：检查服务器连接状态
   */
  useEffect(() => {
    let cancelled = false

    async function bootstrapServerStatus() {
      setServerStatus('checking')

      try {
        // 发送健康检查请求
        await readJson(withApiBase('/api/health'))

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

    // 清理：防止内存泄漏
    return () => {
      cancelled = true
    }
  }, [setErrorMessage, setServerStatus])

  /**
   * 处理文件夹选择事件
   * 弹出系统文件选择器，让用户选择本地仓库
   */
  async function handlePickFolder() {
    setBootstrapping(true)
    setErrorMessage(null)

    try {
      // 调用系统文件夹选择器
      const snapshot = await pickLocalRepository()
      // 初始化工作区（加载仓库树、配置等）
      bootstrapWorkspace(snapshot)
    } catch (error) {
      // 用户中止了选择，无需显示错误
      if (isFolderPickerAbortError(error)) {
        return
      }

      setErrorMessage(buildErrorMessage(error))
    } finally {
      setBootstrapping(false)
    }
  }

  /**
   * 处理文件打开事件
   * 从本地仓库读取文件并在编辑器中预览
   * @param path 文件相对路径
   */
  async function handleOpenFile(path: string) {
    try {
      setErrorMessage(null)
      // 从本地仓库读取文件内容
      const file = await readSelectedRepoFile(path)
      // 在检查器面板打开预览
      openFilePreview(file)
    } catch (error) {
      setErrorMessage(buildErrorMessage(error))
    }
  }

  /**
   * 处理应用代码建议事件
   * 将 AI 提议的修改写入本地文件
   * @param index 建议在列表中的索引
   * @param suggestion 包含目标路径和新内容的建议对象
   */
  async function handleApplySuggestion(index: number, suggestion: PendingSuggestion) {
    setApplyingSuggestionIndex(index)
    setErrorMessage(null)

    try {
      // 将修改写入本地文件
      const updatedFile = await writeSelectedRepoFile(suggestion.targetPath, suggestion.updatedContent)

      // 如果修改的文件当前处于打开状态，更新编辑器内容
      if (openFile?.path === updatedFile.path || openFile?.path === suggestion.targetPath) {
        replaceOpenFileContent(updatedFile)
      }

      // 移除已应用的建议
      removeSuggestionAt(index)
      // 在聊天面板显示系统消息
      appendAssistantMessage(`[系统] 已应用 ${updatedFile.path} 的修改`)
    } catch (error) {
      setErrorMessage(buildErrorMessage(error))
    } finally {
      setApplyingSuggestionIndex(null)
    }
  }

  /**
   * 处理丢弃建议事件
   * 删除未应用的代码建议
   * @param index 建议在列表中的索引
   */
  function handleDiscardSuggestion(index: number) {
    // 如果正在应用其他建议，则不允许丢弃
    if (applyingSuggestionIndex !== null) {
      return
    }

    removeSuggestionAt(index)
  }

  /**
   * 处理发送聊天消息事件
   * 向 AI 助手发送用户消息并接收回复
   */
  async function handleSendMessage() {
    const nextMessage = draftMessage.trim()

    // 验证是否能发送消息
    if (!nextMessage || isSendingMessage) {
      return
    }

    // 验证是否打开了仓库
    if (!repoRoot || repoNodes.length === 0) {
      setErrorMessage('请先打开本地项目文件夹，再开始提问或请求代码修改建议。')
      return
    }

    // 构建最近的消息历史
    const recentHistory = buildRecentHistory(messages)

    // 更新 UI 状态
    appendUserMessage(nextMessage)
    setDraftMessage('')
    startSendingMessage()
    setErrorMessage(null)

    try {
      // 构建请求负载（包含消息、上下文、历史等）
      const payload = await buildChatRequestPayload(nextMessage, selectedContextPaths, recentHistory)
      let hasCompleted = false

      // 发起流式请求，接收实时的 AI 回复
      await streamChatRequest(payload, {
        onEvent: (event) => {
          // 收到上下文元数据
          if (event.type === 'context') {
            beginAssistantStream(event.contextMeta)
            return
          }

          // 收到回复内容块
          if (event.type === 'chunk') {
            appendAssistantStreamChunk(event.content)
            return
          }

          // 流完成，收到最终回复
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

          // 发生错误
          throw new Error(event.message)
        },
      })

      // 检查流是否正常完成
      if (!hasCompleted) {
        throw new Error('The stream ended before a final assistant message was received.')
      }
    } catch (error) {
      // 流式请求失败，尝试非流式备用方案
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
        // 备用方案也失败，显示组合错误信息
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
      {/* 顶部工作区头部 */}
      <header className="workspace-topbar">
        <div className="workspace-topbar__title">
          <p className="workspace-topbar__eyebrow">AI 仓库助手</p>
          <h1>仓库级代码工作台</h1>
        </div>
        <div className="workspace-topbar__meta">
          {/* 显示服务器连接状态 */}
          <span className={`status-pill status-pill--${serverStatus}`}>{getServerStatusLabel(serverStatus)}</span>
          {/* 显示已选择的上下文文件数量 */}
          <span className="meta-card">{selectedContextPaths.length} 个上下文文件</span>
          {/* 显示当前打开的仓库根路径 */}
          <span className="meta-card meta-card--path">{repoRoot || '未打开仓库'}</span>
        </div>
      </header>

      {/* 错误提示区域 */}
      {errorMessage ? <div className="workspace-alert">{errorMessage}</div> : null}

      {/* 主工作区：三分栏布局 */}
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
