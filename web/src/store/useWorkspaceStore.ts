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

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  repoRoot: '',
  repoRootInput: '',
  repoNodes: [],
  openFile: null,
  selectedContextPaths: [],
  messages: initialSession.messages,
  draftMessage: initialSession.draftMessage,
  inspectorMode: 'code',
  diffPreviews: [],
  pendingSuggestions: [],
  activeSuggestionIndex: 0,
  lastContextMeta: null,
  isBootstrapping: false,
  isSendingMessage: false,
  streamingAssistantId: null,
  serverStatus: 'checking',
  errorMessage: null,
  setBootstrapping: (value) => set({ isBootstrapping: value }),
  setServerStatus: (status) => set({ serverStatus: status }),
  setErrorMessage: (message) => set({ errorMessage: message }),
  setRepoRootInput: (value) => set({ repoRootInput: value }),
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
  replaceOpenFileContent: (file) =>
    set({
      openFile: file,
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
  setDraftMessage: (value) =>
    set((state) => {
      persistSession(state.messages, value)
      return { draftMessage: value }
    }),
  appendUserMessage: (content) =>
    set((state) => {
      const nextMessages = [...state.messages, buildMessage('user', content)]
      persistSession(nextMessages, state.draftMessage)

      return {
        messages: nextMessages,
      }
    }),
  appendAssistantMessage: (content) =>
    set((state) => {
      const nextMessages = [...state.messages, buildMessage('assistant', content)]
      persistSession(nextMessages, state.draftMessage)

      return {
        messages: nextMessages,
      }
    }),
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
  setInspectorMode: (mode) => set({ inspectorMode: mode }),
  clearDiffPreview: () =>
    set((state) => ({
      diffPreviews: [],
      pendingSuggestions: [],
      activeSuggestionIndex: 0,
      inspectorMode: state.openFile ? 'code' : state.inspectorMode,
    })),
  setActiveSuggestionIndex: (index) =>
    set((state) => ({
      activeSuggestionIndex: clampSuggestionIndex(index, state.diffPreviews.length),
    })),
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
