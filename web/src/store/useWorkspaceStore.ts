import type {
  ChatContextMeta,
  DiffPreview,
  InspectorMode,
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
  diffPreview: DiffPreview | null
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
  toggleContextPath: (path: string) => void
  setDraftMessage: (value: string) => void
  appendUserMessage: (content: string) => void
  startSendingMessage: () => void
  beginAssistantStream: (contextMeta: ChatContextMeta) => void
  appendAssistantStreamChunk: (chunk: string) => void
  finishAssistantMessage: (message: WorkspaceMessage, diffPreview?: DiffPreview | null, contextMeta?: ChatContextMeta | null) => void
  setInspectorMode: (mode: InspectorMode) => void
  clearDiffPreview: () => void
}

const starterMessage: WorkspaceMessage = {
  id: 'assistant-welcome',
  role: 'assistant',
  content: 'Day 3 can answer questions using the files you selected as context.',
  createdAt: new Date().toISOString(),
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
  diffPreview: null,
  // 最新一次对话使用的上下文元数据
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
      diffPreview: null,
      lastContextMeta: null,
      errorMessage: null,
    }),
  // 打开文件预览
  openFilePreview: (file) =>
    set({
      openFile: file,
      inspectorMode: 'code',
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
      messages: [
        ...state.messages,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content,
          createdAt: new Date().toISOString(),
        },
      ],
    })),
  // 开始发送消息
  startSendingMessage: () =>
    set({
      isSendingMessage: true,
      lastContextMeta: null,
      streamingAssistantId: null,
    }),
  // 开始助手流式响应
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
  // 完成助手消息
  finishAssistantMessage: (message, diffPreview, contextMeta) =>
    set((state) => {
      const nextMessages = state.streamingAssistantId
        ? state.messages.map((item) => (item.id === state.streamingAssistantId ? message : item))
        : [...state.messages, message]

      return {
        messages: nextMessages,
        diffPreview: diffPreview ?? null,
        inspectorMode: diffPreview ? 'diff' : state.inspectorMode,
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
      diffPreview: null,
      inspectorMode: state.openFile ? 'code' : state.inspectorMode,
    })),
}))