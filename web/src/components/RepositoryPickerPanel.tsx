import type { RepoNode } from '@ai-repo-assistant/shared'

import { PanelCard } from './PanelCard'

type RepositoryPickerPanelProps = {
  repoRoot: string
  nodes: RepoNode[]
  activePath: string | null
  selectedContextPaths: string[]
  serverStatus: string
  isBootstrapping: boolean
  onPickFolder: () => void
  onOpenFile: (path: string) => void
  onToggleContext: (path: string) => void
}

type RepositoryTreeNodeProps = {
  node: RepoNode
  depth: number
  activePath: string | null
  selectedContextPaths: string[]
  onOpenFile: (path: string) => void
  onToggleContext: (path: string) => void
}

function RepositoryTreeNode({
  node,
  depth,
  activePath,
  selectedContextPaths,
  onOpenFile,
  onToggleContext,
}: RepositoryTreeNodeProps) {
  if (node.type === 'directory') {
    return (
      <details className="tree-folder" open>
        <summary style={{ paddingLeft: `${depth * 14}px` }}>{node.name}</summary>
        <div className="tree-folder__children">
          {node.children?.map((child) => (
            <RepositoryTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              selectedContextPaths={selectedContextPaths}
              onOpenFile={onOpenFile}
              onToggleContext={onToggleContext}
            />
          ))}
        </div>
      </details>
    )
  }

  const isActive = activePath === node.path
  const isSelected = selectedContextPaths.includes(node.path)

  return (
    <div className={`tree-file ${isActive ? 'tree-file--active' : ''}`} style={{ paddingLeft: `${depth * 14}px` }}>
      <button className="tree-file__button" type="button" onClick={() => onOpenFile(node.path)}>
        <span className="tree-file__name">{node.name}</span>
        <span className="tree-file__language">{node.language}</span>
      </button>
      <label className="tree-file__context">
        <input checked={isSelected} type="checkbox" onChange={() => onToggleContext(node.path)} />
        <span>Ctx</span>
      </label>
    </div>
  )
}

export function RepositoryPickerPanel({
  repoRoot,
  nodes,
  activePath,
  selectedContextPaths,
  serverStatus,
  isBootstrapping,
  onPickFolder,
  onOpenFile,
  onToggleContext,
}: RepositoryPickerPanelProps) {
  const subtitle = repoRoot
    ? `${repoRoot} - ${selectedContextPaths.length} context file(s) selected`
    : 'Pick a local folder to load a repository'

  return (
    <PanelCard
      title="Repository"
      subtitle={subtitle}
      actions={<span className={`status-pill status-pill--${serverStatus}`}>{serverStatus}</span>}
    >
      {/* The toolbar stays fixed at the top of the panel. Only the tree below should scroll. */}
      <div className="repo-picker-toolbar">
        <button className="repo-picker-toolbar__button" disabled={isBootstrapping} type="button" onClick={onPickFolder}>
          {isBootstrapping ? 'Loading...' : 'Open Folder'}
        </button>
        <p className="repo-picker-toolbar__hint">Use the system folder picker so users do not have to paste a local path manually.</p>
      </div>

      {isBootstrapping ? <p className="panel-empty">Reading files from the selected folder...</p> : null}
      {!isBootstrapping && nodes.length === 0 ? (
        <p className="panel-empty">No previewable source files were found. Try another project folder.</p>
      ) : null}
      {!isBootstrapping ? (
        <div className="tree-root">
          {nodes.map((node) => (
            <RepositoryTreeNode
              key={node.id}
              node={node}
              depth={0}
              activePath={activePath}
              selectedContextPaths={selectedContextPaths}
              onOpenFile={onOpenFile}
              onToggleContext={onToggleContext}
            />
          ))}
        </div>
      ) : null}
    </PanelCard>
  )
}