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

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  repoRoot: '',
  repoRootInput: '',
  repoNodes: [],
  openFile: null,
  selectedContextPaths: [],
  messages: [starterMessage],
  draftMessage: '',
  inspectorMode: 'code',
  diffPreviews: [],
  pendingSuggestions: [],
  activeSuggestionIndex: 0,
  lastContextMeta: null,
  isBootstrapping: false,
  isSendingMessage: false,
  // 正在流式传输的助手消息ID，用于在消息列表中找到对应消息并追加内容
  streamingAssistantId: null,
  serverStatus: 'checking',
  errorMessage: null,
  // 设置正在启动状态
  setBootstrapping: (value) => set({ isBootstrapping: value }),
  // 设置服务器状态
  setServerStatus: (status) => set({ serverStatus: status }),
  // 设置错误信息
  setErrorMessage: (message) => set({ errorMessage: message }),
  // 设置仓库根目录输入值
  setRepoRootInput: (value) => set({ repoRootInput: value }),
  // 初始化工作区
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
  openFilePreview: (file) =>
    set({
      openFile: file,
      inspectorMode: 'code',
      diffPreviews: [],
      pendingSuggestions: [],
      activeSuggestionIndex: 0,
      errorMessage: null,
    }),
  // 审批应用修改后，如果只是刷新当前打开文件内容，不应该顺带清空其它待审批建议。
  replaceOpenFileContent: (file) =>
    set({
      openFile: file,
      errorMessage: null,
    }),
  // 切换上下文文件路径选中状态
  toggleContextPath: (path) =>
    set((state) => {
      const isSelected = state.selectedContextPaths.includes(path)

      return {
        selectedContextPaths: isSelected
          ? state.selectedContextPaths.filter((item) => item !== path)
          : [...state.selectedContextPaths.slice(-4), path],
      }
    }),
  // 设置草稿消息
  setDraftMessage: (value) => set({ draftMessage: value }),
  // 添加用户消息
  appendUserMessage: (content) =>
    set((state) => ({
      messages: [...state.messages, buildMessage('user', content)],
    })),
  appendAssistantMessage: (content) =>
    set((state) => ({
      messages: [...state.messages, buildMessage('assistant', content)],
    })),
  // 开始发送消息
  startSendingMessage: () =>
    set((state) => ({
      isSendingMessage: true,
      lastContextMeta: null,
      streamingAssistantId: null,
      diffPreviews: [],
      pendingSuggestions: [],
      activeSuggestionIndex: 0,
      inspectorMode: state.openFile ? 'code' : state.inspectorMode,
    })),
  beginAssistantStream: (contextMeta) =>
    set((state) => {
      const assistantId = `assistant-stream-${Date.now()}`

      return {
        lastContextMeta: contextMeta,
        streamingAssistantId: assistantId,
        messages: [
          ...state.messages,
          {
            id: assistantId,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString(),
          },
        ],
      }
    }),
  // 追加助手流式响应内容
  appendAssistantStreamChunk: (chunk) =>
    set((state) => {
      if (!state.streamingAssistantId) {
        return state
      }

      return {
        messages: state.messages.map((message) =>
          message.id === state.streamingAssistantId
            ? {
                ...message,
                content: `${message.content}${chunk}`,
              }
            : message,
        ),
      }
    }),
  finishAssistantMessage: (message, diffPreviews, pendingSuggestions, contextMeta) =>
    set((state) => {
      const nextMessages = state.streamingAssistantId
        ? state.messages.map((item) => (item.id === state.streamingAssistantId ? message : item))
        : [...state.messages, message]

      const nextDiffPreviews = diffPreviews ?? []
      const nextPendingSuggestions = pendingSuggestions ?? []

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
  // 设置检查器模式
  setInspectorMode: (mode) => set({ inspectorMode: mode }),
  // 清除差异预览
  clearDiffPreview: () =>
    set((state) => ({
      diffPreviews: [],
      pendingSuggestions: [],
      activeSuggestionIndex: 0,
      inspectorMode: state.openFile ? 'code' : state.inspectorMode,
    })),
    // 设置当前激活的建议索引
  setActiveSuggestionIndex: (index) =>
    set((state) => ({
      activeSuggestionIndex: clampSuggestionIndex(index, state.diffPreviews.length),
    })),
    // 移除指定索引的建议
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
