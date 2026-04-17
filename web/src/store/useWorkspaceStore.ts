import type {
  ChatContextMeta,
  DiffPreview,
  InspectorMode,
  PendingSuggestion,
  RepoFile,
  RepoNode,
  WorkspaceMessage,
} from '@ai-repo-assistant/shared'
import { create } from 'zustand'

type ServerStatus = 'checking' | 'online' | 'offline'

type BootstrapPayload = {
  root: string
  nodes: RepoNode[]
  openFile: RepoFile | null
}

type PersistedWorkspaceSession = {
  draftMessage: string
  messages: WorkspaceMessage[]
}

type WorkspaceStore = {
  repoRoot: string
  repoRootInput: string
  repoNodes: RepoNode[]
  openFile: RepoFile | null
  selectedContextPaths: string[]
  messages: WorkspaceMessage[]
  draftMessage: string
  inspectorMode: InspectorMode
  diffPreviews: DiffPreview[]
  pendingSuggestions: PendingSuggestion[]
  activeSuggestionIndex: number
  lastContextMeta: ChatContextMeta | null
  isBootstrapping: boolean
  isSendingMessage: boolean
  streamingAssistantId: string | null
  serverStatus: ServerStatus
  errorMessage: string | null
  setBootstrapping: (value: boolean) => void
  setServerStatus: (status: ServerStatus) => void
  setErrorMessage: (message: string | null) => void
  setRepoRootInput: (value: string) => void
  bootstrapWorkspace: (payload: BootstrapPayload) => void
  openFilePreview: (file: RepoFile) => void
  replaceOpenFileContent: (file: RepoFile) => void
  toggleContextPath: (path: string) => void
  setDraftMessage: (value: string) => void
  appendUserMessage: (content: string) => void
  appendAssistantMessage: (content: string) => void
  startSendingMessage: () => void
  beginAssistantStream: (contextMeta: ChatContextMeta) => void
  appendAssistantStreamChunk: (chunk: string) => void
  finishAssistantMessage: (
    message: WorkspaceMessage,
    diffPreviews?: DiffPreview[],
    pendingSuggestions?: PendingSuggestion[],
    contextMeta?: ChatContextMeta | null,
  ) => void
  setInspectorMode: (mode: InspectorMode) => void
  clearDiffPreview: () => void
  setActiveSuggestionIndex: (index: number) => void
  removeSuggestionAt: (index: number) => void
}

const SESSION_STORAGE_KEY = 'ai-repo-assistant.workspace-session'

const starterMessage: WorkspaceMessage = {
  id: 'assistant-welcome',
  role: 'assistant',
  content: '先选择本地项目文件夹，再挑选上下文文件和我对话。',
  createdAt: new Date().toISOString(),
}

function buildMessage(role: 'user' | 'assistant', content: string): WorkspaceMessage {
  return {
    id: `${role}-${Date.now()}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

function clampSuggestionIndex(nextIndex: number, total: number) {
  if (total <= 0) {
    return 0
  }

  return Math.min(Math.max(nextIndex, 0), total - 1)
}

function isWorkspaceMessage(value: unknown): value is WorkspaceMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const message = value as Record<string, unknown>
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    typeof message.createdAt === 'string'
  )
}

function readPersistedSession(): PersistedWorkspaceSession {
  if (typeof window === 'undefined') {
    return {
      draftMessage: '',
      messages: [starterMessage],
    }
  }

  try {
    const rawValue = window.localStorage.getItem(SESSION_STORAGE_KEY)

    if (!rawValue) {
      return {
        draftMessage: '',
        messages: [starterMessage],
      }
    }

    const parsed = JSON.parse(rawValue) as Partial<PersistedWorkspaceSession>
    const messages = Array.isArray(parsed.messages) ? parsed.messages.filter(isWorkspaceMessage) : []
    const draftMessage = typeof parsed.draftMessage === 'string' ? parsed.draftMessage : ''

    return {
      draftMessage,
      messages: messages.length > 0 ? messages : [starterMessage],
    }
  } catch {
    return {
      draftMessage: '',
      messages: [starterMessage],
    }
  }
}

function persistSession(messages: WorkspaceMessage[], draftMessage: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        draftMessage,
        messages,
      } satisfies PersistedWorkspaceSession),
    )
  } catch {
    // 会话持久化只是附加体验，失败时不应该影响主流程。
  }
}

const initialSession = readPersistedSession()

/**
 * 工作区状态管理 Store
 * 
 * 负责管理整个应用的核心状态，包括：
 * - 代码仓库信息（根路径、文件树、打开的文件）
 * - 消息对话历史和草稿
 * - UI 状态（检查器模式、差异预览、建议）
 * - 服务器通信状态（发送消息、流式传输、错误信息）
 * 
 * @remarks
 * 使用 Zustand 作为状态管理库，提供响应式的状态更新和订阅机制
 * 
 * @example
 * ```typescript
 * // 获取当前状态
 * const messages = useWorkspaceStore((state) => state.messages);
 * 
 * // 更新状态
 * useWorkspaceStore.setState({ draftMessage: 'new message' });
 * ```
 */
export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  // ==================== 仓库信息状态 ====================
  /** 仓库根路径 */
  repoRoot: '',

  /** 仓库根路径输入框值 */
  repoRootInput: '',

  /** 仓库文件树节点 */
  repoNodes: [],

  /** 当前打开的文件信息 */
  openFile: null,

  // ==================== 上下文选择状态 ====================
  /** 选中的上下文路径列表 */
  selectedContextPaths: [],

  // ==================== 消息和对话状态 ====================
  /** 消息历史列表 */
  messages: initialSession.messages,

  /** 消息输入框草稿 */
  draftMessage: initialSession.draftMessage,

  // ==================== UI 状态 ====================
  /** 检查器模式：'code' 或 'diff' */
  inspectorMode: 'code',

  /** 差异预览列表 */
  diffPreviews: [],

  /** 待处理的建议列表 */
  pendingSuggestions: [],

  /** 当前激活的建议索引 */
  activeSuggestionIndex: 0,

  // ==================== 流式传输状态 ====================
  /** 最后一次上下文元数据 */
  lastContextMeta: null,

  /** 是否正在初始化工作区 */
  isBootstrapping: false,

  /** 是否正在发送消息 */
  isSendingMessage: false,

  /** 当前流式传输的助手消息 ID，用于跟踪流式响应 */
  streamingAssistantId: null,

  // ==================== 服务器状态 ====================
  /** 服务器状态：'checking' | 'connected' | 'disconnected' */
  serverStatus: 'checking',

  /** 错误消息 */
  errorMessage: null,

  // ==================== 状态更新方法 ====================
  /**
   * 设置初始化状态
   * @param value - 是否正在初始化
   */
  setBootstrapping: (value) => set({ isBootstrapping: value }),

  /**
   * 设置服务器状态
   * @param status - 新的服务器状态
   */
  setServerStatus: (status) => set({ serverStatus: status }),

  /**
   * 设置错误消息
   * @param message - 错误信息内容
   */
  setErrorMessage: (message) => set({ errorMessage: message }),

  /**
   * 设置仓库路径输入框值
   * @param value - 输入框的值
   */
  setRepoRootInput: (value) => set({ repoRootInput: value }),

  /**
   * 初始化工作区
   * 加载仓库信息并重置相关状态
   * @param root - 仓库根路径
   * @param nodes - 文件树节点
   * @param openFile - 要打开的文件
   */
  bootstrapWorkspace: ({ root, nodes, openFile }) =>
    set({
      repoRoot: root,
      repoRootInput: root,
      repoNodes: nodes,
      openFile,
      selectedContextPaths: openFile ? [openFile.path] : [],
      inspectorMode: 'code',
      diffPreviews: [],
      pendingSuggestions: [],
      activeSuggestionIndex: 0,
      lastContextMeta: null,
      errorMessage: null,
    }),

  /**
   * 打开文件预览
   * @param file - 要预览的文件
   */
  openFilePreview: (file) =>
    set({
      openFile: file,
      inspectorMode: 'code',
      diffPreviews: [],
      pendingSuggestions: [],
      activeSuggestionIndex: 0,
      errorMessage: null,
    }),

  /**
   * 替换打开的文件内容
   * @param file - 新的文件内容
   */
  replaceOpenFileContent: (file) =>
    set({
      openFile: file,
      errorMessage: null,
    }),

  /**
   * 切换上下文路径的选中状态
   * 最多保留最后 5 个选中的路径
   * @param path - 要切换的路径
   */
  toggleContextPath: (path) =>
    set((state) => {
      const isSelected = state.selectedContextPaths.includes(path)

      return {
        selectedContextPaths: isSelected
          ? state.selectedContextPaths.filter((item) => item !== path)
          : [...state.selectedContextPaths.slice(-4), path],
      }
    }),

  /**
   * 设置消息草稿
   * 并持久化到本地存储
   * @param value - 草稿内容
   */
  setDraftMessage: (value) =>
    set((state) => {
      persistSession(state.messages, value)
      return { draftMessage: value }
    }),

  /**
   * 追加用户消息
   * @param content - 消息内容
   */
  appendUserMessage: (content) =>
    set((state) => {
      const nextMessages = [...state.messages, buildMessage('user', content)]
      persistSession(nextMessages, state.draftMessage)

      return {
        messages: nextMessages,
      }
    }),

  /**
   * 追加助手消息
   * @param content - 消息内容
   */
  appendAssistantMessage: (content) =>
    set((state) => {
      const nextMessages = [...state.messages, buildMessage('assistant', content)]
      persistSession(nextMessages, state.draftMessage)

      return {
        messages: nextMessages,
      }
    }),

  /**
   * 开始发送消息
   * 创建新的助手消息占位符并设置发送状态
   */
  startSendingMessage: () =>
    set((state) => {
      const assistantId = `assistant-stream-${Date.now()}`
      const nextMessages = [
        ...state.messages,
        {
          id: assistantId,
          role: 'assistant' as const,
          content: '',
          createdAt: new Date().toISOString(),
        },
      ]

      persistSession(nextMessages, state.draftMessage)

      return {
        isSendingMessage: true,
        lastContextMeta: null,
        streamingAssistantId: assistantId,
        diffPreviews: [],
        pendingSuggestions: [],
        activeSuggestionIndex: 0,
        inspectorMode: state.openFile ? 'code' : state.inspectorMode,
        messages: nextMessages,
      }
    }),

  /**
   * 开始助手流式传输
   * 如果已有流式传输在进行，只更新上下文元数据
   * @param contextMeta - 上下文元数据
   */
  beginAssistantStream: (contextMeta) =>
    set((state) => {
      if (state.streamingAssistantId) {
        return {
          lastContextMeta: contextMeta,
        }
      }

      const assistantId = `assistant-stream-${Date.now()}`
      const nextMessages = [
        ...state.messages,
        {
          id: assistantId,
          role: 'assistant' as const,
          content: '',
          createdAt: new Date().toISOString(),
        },
      ]

      persistSession(nextMessages, state.draftMessage)

      return {
        lastContextMeta: contextMeta,
        streamingAssistantId: assistantId,
        messages: nextMessages,
      }
    }),

  /**
   * 追加助手流式传输块
   * 将文本块追加到当前流式消息中
   * @param chunk - 文本块内容
   */
  appendAssistantStreamChunk: (chunk) =>
    set((state) => {
      if (!state.streamingAssistantId) {
        return state
      }

      const nextMessages = state.messages.map((message) =>
        message.id === state.streamingAssistantId
          ? {
            ...message,
            content: `${message.content}${chunk}`,
          }
          : message,
      )

      persistSession(nextMessages, state.draftMessage)

      return {
        messages: nextMessages,
      }
    }),

  /**
   * 完成助手消息
   * 结束流式传输并处理差异预览和建议
   * @param message - 完整的消息对象
   * @param diffPreviews - 差异预览列表
   * @param pendingSuggestions - 待处理建议列表
   * @param contextMeta - 上下文元数据
   */
  finishAssistantMessage: (message, diffPreviews, pendingSuggestions, contextMeta) =>
    set((state) => {
      const nextMessages = state.streamingAssistantId
        ? state.messages.map((item) => (item.id === state.streamingAssistantId ? message : item))
        : [...state.messages, message]

      const nextDiffPreviews = diffPreviews ?? []
      const nextPendingSuggestions = pendingSuggestions ?? []

      persistSession(nextMessages, state.draftMessage)

      return {
        messages: nextMessages,
        diffPreviews: nextDiffPreviews,
        pendingSuggestions: nextPendingSuggestions,
        activeSuggestionIndex: 0,
        inspectorMode: nextDiffPreviews.length > 0 ? 'diff' : state.openFile ? 'code' : state.inspectorMode,
        isSendingMessage: false,
        streamingAssistantId: null,
        lastContextMeta: contextMeta ?? state.lastContextMeta,
      }
    }),

  /**
   * 设置检查器模式
   * @param mode - 新的模式值：'code' 或 'diff'
   */
  setInspectorMode: (mode) => set({ inspectorMode: mode }),

  /**
   * 清空差异预览
   * 重置差异、建议和检查器模式
   */
  clearDiffPreview: () =>
    set((state) => ({
      diffPreviews: [],
      pendingSuggestions: [],
      activeSuggestionIndex: 0,
      inspectorMode: state.openFile ? 'code' : state.inspectorMode,
    })),

  /**
   * 设置当前激活的建议索引
   * @param index - 新的索引值，会自动夹取到有效范围内
   */
  setActiveSuggestionIndex: (index) =>
    set((state) => ({
      activeSuggestionIndex: clampSuggestionIndex(index, state.diffPreviews.length),
    })),

  /**
   * 移除指定索引的建议
   * @param index - 要移除的建议索引
   */
  removeSuggestionAt: (index) =>
    set((state) => {
      const nextDiffPreviews = state.diffPreviews.filter((_, itemIndex) => itemIndex !== index)
      const nextPendingSuggestions = state.pendingSuggestions.filter((_, itemIndex) => itemIndex !== index)

      return {
        diffPreviews: nextDiffPreviews,
        pendingSuggestions: nextPendingSuggestions,
        activeSuggestionIndex: clampSuggestionIndex(state.activeSuggestionIndex, nextDiffPreviews.length),
        inspectorMode: nextDiffPreviews.length > 0 ? 'diff' : state.openFile ? 'code' : state.inspectorMode,
      }
    }),
}))
