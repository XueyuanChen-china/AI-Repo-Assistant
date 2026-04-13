// This file is kept only as a lightweight note for the retired server-driven workspace.
// The active page is FolderPickerWorkspacePage.tsx.
// We keep this export so older imports do not break the project build.
export function WorkspacePage() {
  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <div>
          <p className="workspace-topbar__eyebrow">LEGACY PAGE</p>
          <h1>WorkspacePageExpired has been retired</h1>
          <p className="workspace-topbar__summary">
            The project now uses the browser-driven folder picker workflow in FolderPickerWorkspacePage.tsx.
          </p>
        </div>
      </header>
    </div>
  )
}