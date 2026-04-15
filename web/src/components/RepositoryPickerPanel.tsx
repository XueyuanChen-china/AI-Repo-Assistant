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

function getServerStatusLabel(serverStatus: string) {
  if (serverStatus === 'online') {
    return '在线'
  }

  if (serverStatus === 'offline') {
    return '离线'
  }

  return '检查中'
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
        <span>上下文</span>
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
  const subtitle = repoRoot || '请选择本地文件夹'

  return (
    <PanelCard
      title="仓库"
      subtitle={subtitle}
      actions={<span className={`status-pill status-pill--${serverStatus}`}>{getServerStatusLabel(serverStatus)}</span>}
    >
      <div className="repo-picker-toolbar">
        <button className="repo-picker-toolbar__button" disabled={isBootstrapping} type="button" onClick={onPickFolder}>
          {isBootstrapping ? '读取中...' : '打开文件夹'}
        </button>
        <span className="repo-picker-toolbar__meta">{selectedContextPaths.length} 个上下文文件</span>
      </div>

      {isBootstrapping ? <p className="panel-empty">正在读取所选文件夹中的文件...</p> : null}
      {!isBootstrapping && nodes.length === 0 ? (
        <p className="panel-empty">没有找到可预览的源码文件，请重新选择项目文件夹。</p>
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
