import type { RepoNode } from '@ai-repo-assistant/shared'

import { PanelCard } from './PanelCard'

type FileTreePanelProps = {
  repoRoot: string
  nodes: RepoNode[]
  activePath: string | null
  selectedContextPaths: string[]
  serverStatus: string
  isBootstrapping: boolean
  onOpenFile: (path: string) => void
  onToggleContext: (path: string) => void
}

type FileTreeNodeProps = {
  node: RepoNode
  depth: number
  activePath: string | null
  selectedContextPaths: string[]
  onOpenFile: (path: string) => void
  onToggleContext: (path: string) => void
}

function FileTreeNode({
  node,
  depth,
  activePath,
  selectedContextPaths,
  onOpenFile,
  onToggleContext,
}: FileTreeNodeProps) {
  // 遇到目录就递归渲染子节点。
  // 这是文件树组件最核心的思路：目录和文件都属于“节点”，只是展示方式不同。
  if (node.type === 'directory') {
    return (
      <details className="tree-folder" open>
        <summary style={{ paddingLeft: `${depth * 14}px` }}>{node.name}</summary>
        <div className="tree-folder__children">
          {node.children?.map((child) => (
            <FileTreeNode
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

export function FileTreePanel({
  repoRoot,
  nodes,
  activePath,
  selectedContextPaths,
  serverStatus,
  isBootstrapping,
  onOpenFile,
  onToggleContext,
}: FileTreePanelProps) {
  const subtitle = repoRoot ? `${repoRoot} · ${selectedContextPaths.length} context file(s)` : 'Waiting for workspace bootstrap'

  return (
    <PanelCard
      title="Repository"
      subtitle={subtitle}
      actions={<span className={`status-pill status-pill--${serverStatus}`}>{serverStatus}</span>}
    >
      {isBootstrapping ? <p className="panel-empty">Loading mock repository…</p> : null}
      {!isBootstrapping && nodes.length === 0 ? <p className="panel-empty">No files are available yet.</p> : null}
      {!isBootstrapping ? (
        <div className="tree-root">
          {nodes.map((node) => (
            <FileTreeNode
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
