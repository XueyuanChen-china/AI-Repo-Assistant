import type { DiffPreview, InspectorMode, RepoFile, RepoNode, WorkspaceMessage } from '@ai-repo-assistant/shared'
import { create } from 'zustand'

type ServerStatus = 'checking' | 'online' | 'offline'

type BootstrapPayload = {
  root: string
  nodes: RepoNode[]
  openFile: RepoFile | null
}

// Zustand store 可以把它理解成“这个页面共用的小型状态中心”。
// 文件树、聊天区、右侧预览区都从这里拿状态，避免层层传 props。
type WorkspaceStore = {
  //当前仓库根名称。
  repoRoot: string
  //左侧文件树完整数据。
  repoNodes: RepoNode[]
  //右侧当前正在预览的文件。
  openFile: RepoFile | null
  //当前被勾选进 AI 上下文的文件路径列表。
  selectedContextPaths: string[]
  //中间聊天区的消息列表。
  messages: WorkspaceMessage[]
  //输入框里当前还没发出去的草稿内容。
  draftMessage: string
  //右侧预览面板当前的模式，是在看代码还是看 diff。
  inspectorMode: InspectorMode
  // 当前 diff 预览的数据，null 代表没有正在看的 diff。
  diffPreview: DiffPreview | null
  // 启动流程相关的状态，主要是为了控制界面上显示“正在启动中...”的提示。
  isBootstrapping: boolean
  // 发送消息相关的状态
  isSendingMessage: boolean
  // 后端服务器的状态，决定了用户能不能正常使用这个工具。
  serverStatus: ServerStatus
  // 发生错误时的错误信息，用来展示给用户。
  errorMessage: string | null
  // 一系列修改状态的方法，组件里调用这些方法来修改状态，而不是直接 set。
  setBootstrapping: (value: boolean) => void
  setServerStatus: (status: ServerStatus) => void
  setErrorMessage: (message: string | null) => void
  // 启动时把第一份仓库快照塞进 store。
  bootstrapWorkspace: (payload: BootstrapPayload) => void
  // 打开文件预览
  openFilePreview: (file: RepoFile) => void
  // 上下文文件最多保留 5 个，模拟后面真实模型会遇到的上下文预算问题。
  toggleContextPath: (path: string) => void
  // 修改输入框草稿内容。
  setDraftMessage: (value: string) => void
  // 追加一条用户消息到消息列表里。
  appendUserMessage: (content: string) => void
  // 发送消息相关的状态修改方法，控制发送流程和结果。
  startSendingMessage: () => void
  // 收到 AI 回复后，把消息追加到消息列表里，如果有 diff 预览数据也一起塞进去。
  finishAssistantMessage: (message: WorkspaceMessage, diffPreview?: DiffPreview | null) => void
  // 切换右侧预览面板的模式。
  setInspectorMode: (mode: InspectorMode) => void
  // 关闭 diff 预览，回到代码预览模式。
  clearDiffPreview: () => void
}

const starterMessage: WorkspaceMessage = {
  id: 'assistant-welcome',
  role: 'assistant',
  content:
    'Welcome to Day 1 of AI Repo Assistant. Select a few files, ask a repo question, or request a mock code change to preview the diff flow.',
  createdAt: new Date().toISOString(),
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  repoRoot: '',
  repoNodes: [],
  openFile: null,
  selectedContextPaths: [],
  messages: [starterMessage],
  draftMessage: '',
  inspectorMode: 'code',
  diffPreview: null,
  isBootstrapping: false,
  isSendingMessage: false,
  serverStatus: 'checking',
  errorMessage: null,
  setBootstrapping: (value) => set({ isBootstrapping: value }),
  setServerStatus: (status) => set({ serverStatus: status }),
  setErrorMessage: (message) => set({ errorMessage: message }),
  bootstrapWorkspace: ({ root, nodes, openFile }) =>
    set({
      repoRoot: root,
      repoNodes: nodes,
      openFile,
      selectedContextPaths: openFile ? [openFile.path] : [],
      inspectorMode: 'code',
      errorMessage: null,
    }),
  openFilePreview: (file) =>
    set({
      openFile: file,
      inspectorMode: 'code',
      errorMessage: null,
    }),
  toggleContextPath: (path) =>
    set((state) => {
      const isSelected = state.selectedContextPaths.includes(path)

      return {
        selectedContextPaths: isSelected
          ? state.selectedContextPaths.filter((item) => item !== path)
          : [...state.selectedContextPaths.slice(-4), path],
      }
    }),
  setDraftMessage: (value) => set({ draftMessage: value }),
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
  startSendingMessage: () => set({ isSendingMessage: true }),
  finishAssistantMessage: (message, diffPreview) =>
    set((state) => ({
      messages: [...state.messages, message],
      diffPreview: diffPreview ?? null,
      inspectorMode: diffPreview ? 'diff' : state.inspectorMode,
      isSendingMessage: false,
    })),
  setInspectorMode: (mode) => set({ inspectorMode: mode }),
  clearDiffPreview: () =>
    set((state) => ({
      diffPreview: null,
      inspectorMode: state.openFile ? 'code' : state.inspectorMode,
    })),
}))
