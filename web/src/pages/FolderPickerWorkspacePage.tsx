import { useEffect } from 'react'
import { chatResponseSchema, type WorkspaceMessage } from '@ai-repo-assistant/shared'

import { ChatPanel } from '../components/ChatPanel'
import { InspectorPanel } from '../components/InspectorPanel'
import { RepositoryPickerPanel } from '../components/RepositoryPickerPanel'
import { WorkspaceSplitLayout } from '../components/WorkspaceSplitLayout'
import { pickLocalRepository, readSelectedRepoFile } from '../services/localRepoService'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

// Small fetch helper for local API routes.
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

export function FolderPickerWorkspacePage() {
  const repoRoot = useWorkspaceStore((state) => state.repoRoot)
  const repoNodes = useWorkspaceStore((state) => state.repoNodes)
  const openFile = useWorkspaceStore((state) => state.openFile)
  const selectedContextPaths = useWorkspaceStore((state) => state.selectedContextPaths)
  const messages = useWorkspaceStore((state) => state.messages)
  const draftMessage = useWorkspaceStore((state) => state.draftMessage)
  const inspectorMode = useWorkspaceStore((state) => state.inspectorMode)
  const diffPreview = useWorkspaceStore((state) => state.diffPreview)
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

      {/* The main workspace fills the remaining viewport height.
          Each panel inside the split layout keeps its own scroll area. */}
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