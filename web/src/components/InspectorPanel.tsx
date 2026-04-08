import type { DiffPreview, InspectorMode, RepoFile } from '@ai-repo-assistant/shared'

import { PanelCard } from './PanelCard'

type InspectorPanelProps = {
  openFile: RepoFile | null
  inspectorMode: InspectorMode
  diffPreview: DiffPreview | null
  onModeChange: (mode: InspectorMode) => void
}

export function InspectorPanel({ openFile, inspectorMode, diffPreview, onModeChange }: InspectorPanelProps) {
  // 面板标题下的副标题会根据当前状态显示不同内容，帮助用户理解自己在看什么。
  //如果Diff 模式 + 有 diff 预览数据，就显示修改建议预览的标题和摘要。
  //否则Code 模式 + 有文件，就显示文件路径和语言。
  //如果两者都没有，就显示提示语，引导用户打开文件。
  const subtitle =
    inspectorMode === 'diff' && diffPreview
      ? `${diffPreview.path} · 修改建议预览`
      : openFile
        ? `${openFile.path} · ${openFile.language}`
        : '打开一个文件以查看其内容'

  return (
    <PanelCard
      title="查看器"
      subtitle={subtitle}
      actions={
        <div className="inspector-tabs">
          <button
            className={inspectorMode === 'code' ? 'is-active' : ''}
            type="button"
            onClick={() => onModeChange('code')}
          >
            Code
          </button>
          <button
            className={inspectorMode === 'diff' ? 'is-active' : ''}
            disabled={!diffPreview}
            type="button"
            onClick={() => onModeChange('diff')}
          >
            Diff
          </button>
        </div>
      }
    >
      {/* 右侧面板一共有两种查看模式：普通代码、修改差异。 */}
      {inspectorMode === 'diff' && diffPreview ? (
        <div className="diff-preview">
          <div className="diff-preview__summary">
            <h3>{diffPreview.title}</h3>
            <p>{diffPreview.summary}</p>
          </div>
          <div className="diff-grid">
            <section>
              <h4>Before</h4>
              <pre className="code-block"><code>{diffPreview.before}</code></pre>
            </section>
            <section>
              <h4>After</h4>
              <pre className="code-block code-block--after"><code>{diffPreview.after}</code></pre>
            </section>
          </div>
        </div>
      ) : openFile ? (
        <div className="code-preview">
          <div className="code-preview__meta">
            <span>{openFile.path}</span>
            <span>{openFile.language}</span>
          </div>
          {/* Day 1 先用简单的 pre/code 展示。以后切 Monaco，外层结构不用改。 */}
          {/*<pre>  </pre>标签保留文本原生的格式*/}
          <pre className="code-block"><code>{openFile.content}</code></pre>
        </div>
      ) : (
        <p className="panel-empty">打开一个文件以查看其内容</p>
      )}
    </PanelCard>
  )
}
