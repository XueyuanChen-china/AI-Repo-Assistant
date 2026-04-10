import type { RepoNode } from '@ai-repo-assistant/shared'

import { PanelCard } from './PanelCard'

type FileTreePanelProps = {
  repoRoot: string
  repoRootInput: string
  nodes: RepoNode[]
  activePath: string | null
  selectedContextPaths: string[]
  serverStatus: string
  isBootstrapping: boolean
  onRepoRootInputChange: (value: string) => void
  onReloadRepo: () => void
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
  repoRootInput,
  nodes,
  activePath,
  selectedContextPaths,
  serverStatus,
  isBootstrapping,
  onRepoRootInputChange,
  onReloadRepo,
  onOpenFile,
  onToggleContext,
}: FileTreePanelProps) {
  const subtitle = repoRoot ? `${repoRoot} · ${selectedContextPaths.length} 个上下文文件` : '无仓库加载'

  return (
    <PanelCard
      title="仓库"
      subtitle={subtitle}
      actions={<span className={`status-pill status-pill--${serverStatus}`}>{serverStatus}</span>}
    >
      <form
        className="repo-loader"
        onSubmit={(event) => {
          event.preventDefault()
          onReloadRepo()
        }}
      >
        <label className="repo-loader__label" htmlFor="repo-root-input">
          Repository root
        </label>
        <input
          id="repo-root-input"
          className="repo-loader__input"
          placeholder="For example: D:\\project\\my-repo"
          value={repoRootInput}
          onChange={(event) => onRepoRootInputChange(event.target.value)}
        />
        <button className="repo-loader__button" disabled={isBootstrapping} type="submit">
          {isBootstrapping ? 'Loading...' : 'Reload repo'}
        </button>
      </form>

      <p className="repo-loader__hint">Day 2 reads the real local filesystem. Leave this empty to use the default demo path.</p>

      {isBootstrapping ? <p className="panel-empty">Scanning repository files...</p> : null}
      {!isBootstrapping && nodes.length === 0 ? <p className="panel-empty">No readable text files were found in this repository.</p> : null}
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
