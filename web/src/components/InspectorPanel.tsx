// 导入右侧查看器需要用到的共享类型：
// - DiffPreview: 后端生成的差异预览数据
// - InspectorMode: 右侧面板当前是 code 还是 diff 模式
// - PendingSuggestion: 待审批的修改建议
// - RepoFile: 当前打开文件的基础信息
import type { DiffPreview, InspectorMode, PendingSuggestion, RepoFile } from '@ai-repo-assistant/shared'

import { PanelCard } from './PanelCard'

// InspectorPanel 是整个右侧区域的总组件。
// 它的职责很清晰：
// 1. code 模式下展示当前打开文件
// 2. diff 模式下展示 AI 返回的修改建议
// 3. 提供“切换建议 / 应用修改 / 放弃建议”的交互入口
type InspectorPanelProps = {
  openFile: RepoFile | null
  inspectorMode: InspectorMode
  diffPreviews: DiffPreview[]
  pendingSuggestions: PendingSuggestion[]
  activeSuggestionIndex: number
  applyingSuggestionIndex: number | null
  onModeChange: (mode: InspectorMode) => void
  onActiveSuggestionChange: (index: number) => void
  onApplySuggestion: (index: number, suggestion: PendingSuggestion) => Promise<void>
  onDiscardSuggestion: (index: number) => void
}
// Myers diff 相关类型定义
type MyersOpType = 'equal' | 'add' | 'remove'
// MyersOp 表示一次编辑操作，可以是保持不变、添加一行或删除一行。
type MyersOp = {
  type: MyersOpType
  line: string
}
// DiffRow 是最终用于渲染 diff 视图的行数据结构，包含了 before / after 两侧的内容和行号。
type DiffRow = {
  beforeLineNumber: number | null
  afterLineNumber: number | null
  beforeContent: string
  afterContent: string
  beforeClassName: string
  afterClassName: string
}

// 顶部的 Code / Diff 标签切换。
// 这里本身不保存状态，只负责把点击动作往上抛给页面层。
function InspectorTabs({
  mode,
  hasDiff,
  onChange,
}: {
  mode: InspectorMode
  hasDiff: boolean
  onChange: (m: InspectorMode) => void
}) {
  return (
    <div className="inspector-tabs">
      <button
        className={mode === 'code' ? 'is-active' : ''}
        type="button"
        onClick={() => onChange('code')}
      >
        Code
      </button>
      <button
        className={mode === 'diff' ? 'is-active' : ''}
        disabled={!hasDiff}
        type="button"
        onClick={() => onChange('diff')}
      >
        Diff
      </button>
    </div>
  )
}

// 右侧切换按钮只显示文件名，不显示完整路径，
// 这样多个建议并排时更紧凑，也更像编辑器里的 tab。
function getFileDisplayName(filePath: string) {
  return filePath.split('/').pop() || filePath
}

// 多文件建议切换器。
// 一次聊天可能返回多个文件建议，但右侧不会把所有 diff 同时铺开，
// 而是通过这个小切换器一次只看一个文件。
function SuggestionSwitcher({
  diffPreviews,
  activeSuggestionIndex,
  disabled,
  onChange,
}: {
  diffPreviews: DiffPreview[]
  activeSuggestionIndex: number
  disabled: boolean
  onChange: (index: number) => void
}) {
  if (diffPreviews.length <= 1) {
    return null
  }

  return (
    <div className="suggestion-switcher">
      {diffPreviews.map((diffPreview, index) => (
        <button
          key={`${diffPreview.path}-${index}`}
          className={index === activeSuggestionIndex ? 'is-active' : ''}
          disabled={disabled}
          type="button"
          onClick={() => onChange(index)}
        >
          {getFileDisplayName(diffPreview.path)}
        </button>
      ))}
    </div>
  )
}

// 这是一个按行工作的 Myers diff 算法实现。
// 它采用最短编辑路径思想，能稳定地区分“删除 / 新增 / 保持不变”。
// 输入为 beforeLines（原始行数组）和 afterLines（修改后行数组），输出为 MyersOp[] 操作序列。
function buildMyersOperations(beforeLines: string[], afterLines: string[]): MyersOp[] {
  const n = beforeLines.length // 原始行数
  const m = afterLines.length // 修改后行数
  const max = n + m // 最多需要的编辑步数
  const offset = max // 用于将 k 映射到 v 数组下标
  const trace: number[][] = [] // 记录每一步的 v 数组，用于回溯
  let v = new Array<number>(2 * max + 1).fill(0) // v[k] 表示到达对角线 k 时，x 的最大值

  // d 表示当前编辑距离（步数），从 0 开始逐步增加
  for (let d = 0; d <= max; d += 1) {
    trace.push([...v]) // 保存当前步的 v 数组快照
    // k 的范围是 [-d, d]，步长为 2，保证 d 和 k 同奇偶性
    for (let k = -d; k <= d; k += 2) {
      const index = k + offset // 将 k 映射到 v 数组下标
      let x = 0 // x 表示 beforeLines 的下标

      // 决定是从上方（删除）还是左方（添加）过来
      if (k === -d || (k !== d && v[index - 1] < v[index + 1])) {
        // 从上方过来（添加 afterLines 的一行）
        x = v[index + 1]
      } else {
        // 从左方过来（删除 beforeLines 的一行）
        x = v[index - 1] + 1
      }

      let y = x - k // y 表示 afterLines 的下标

      // 沿着对角线尽可能多地匹配相等的行
      while (x < n && y < m && beforeLines[x] === afterLines[y]) {
        x += 1
        y += 1
      }

      v[index] = x // 更新当前 k 下的 x 最大值

      // 如果已经到达末尾，说明找到了一条最短编辑路径
      if (x >= n && y >= m) {
        return backtrackMyers(trace, beforeLines, afterLines, d, offset)
      }
    }
  }

  // 理论上不会走到这里
  return []
}

// 回溯生成 Myers 编辑操作序列
function backtrackMyers(
  trace: number[][], // 每步的 v 数组快照
  beforeLines: string[],
  afterLines: string[],
  depth: number, // 最短编辑距离
  offset: number,
): MyersOp[] {
  const operations: MyersOp[] = []
  let x = beforeLines.length // 当前 x 坐标
  let y = afterLines.length // 当前 y 坐标

  // 从最后一步开始回溯
  for (let d = depth; d > 0; d -= 1) {
    const v = trace[d] // 当前步的 v 数组
    const k = x - y // 当前对角线
    const index = k + offset // 当前 k 的下标

    let previousK = 0 // 上一步的 k
    // 判断是从上方（添加）还是左方（删除）过来
    if (k === -d || (k !== d && v[index - 1] < v[index + 1])) {
      previousK = k + 1 // 从上方过来
    } else {
      previousK = k - 1 // 从左方过来
    }

    const previousX = v[previousK + offset] // 上一步的 x
    const previousY = previousX - previousK // 上一步的 y

    // 沿对角线回溯所有相等的行
    while (x > previousX && y > previousY) {
      operations.push({
        type: 'equal',
        line: beforeLines[x - 1],
      })
      x -= 1
      y -= 1
    }

    // 判断是添加还是删除
    if (x === previousX) {
      // 添加 afterLines 的一行
      operations.push({
        type: 'add',
        line: afterLines[y - 1],
      })
      y -= 1
    } else {
      // 删除 beforeLines 的一行
      operations.push({
        type: 'remove',
        line: beforeLines[x - 1],
      })
      x -= 1
    }
  }

  // 处理剩余的相等行
  while (x > 0 && y > 0) {
    operations.push({
      type: 'equal',
      line: beforeLines[x - 1],
    })
    x -= 1
    y -= 1
  }

  // 处理剩余的删除操作
  while (x > 0) {
    operations.push({
      type: 'remove',
      line: beforeLines[x - 1],
    })
    x -= 1
  }

  // 处理剩余的添加操作
  while (y > 0) {
    operations.push({
      type: 'add',
      line: afterLines[y - 1],
    })
    y -= 1
  }

  // Myers 算法回溯是逆序的，最后需要反转
  return operations.reverse()
}

// 把 Myers 的编辑操作整理成左右两列可渲染的数据结构。
// equal 会同时占据 before / after 两侧；
// remove 只占据左侧；
// add 只占据右侧。
function buildDiffRows(beforeText: string, afterText: string): DiffRow[] {
  const beforeLines = beforeText.split('\n')
  const afterLines = afterText.split('\n')
  const operations = buildMyersOperations(beforeLines, afterLines)
  const rows: DiffRow[] = []
  let beforeLineNumber = 1
  let afterLineNumber = 1

  for (const operation of operations) {
    if (operation.type === 'equal') {
      rows.push({
        beforeLineNumber,
        afterLineNumber,
        beforeContent: operation.line,
        afterContent: operation.line,
        beforeClassName: '',
        afterClassName: '',
      })
      beforeLineNumber += 1
      afterLineNumber += 1
      continue
    }

    if (operation.type === 'remove') {
      rows.push({
        beforeLineNumber,
        afterLineNumber: null,
        beforeContent: operation.line,
        afterContent: '',
        beforeClassName: 'diff-line--removed',
        afterClassName: '',
      })
      beforeLineNumber += 1
      continue
    }

    rows.push({
      beforeLineNumber: null,
      afterLineNumber,
      beforeContent: '',
      afterContent: operation.line,
      beforeClassName: '',
      afterClassName: 'diff-line--added',
    })
    afterLineNumber += 1
  }

  return rows
}

function DiffCodeBlock({
  rows,
  side,
}: {
  rows: DiffRow[]
  side: 'before' | 'after'
}) {
  return (
    <pre className={`code-block code-block--diff ${side === 'after' ? 'code-block--after' : ''}`}>
      <code>
        {rows.map((row, index) => {
          const lineNumber = side === 'before' ? row.beforeLineNumber : row.afterLineNumber
          const content = side === 'before' ? row.beforeContent : row.afterContent
          const className = side === 'before' ? row.beforeClassName : row.afterClassName

          return (
            <div key={`${side}-${index}`} className={`diff-line ${className}`.trim()}>
              <span className="diff-line__number">{lineNumber ?? ''}</span>
              <span className="diff-line__content">{content || ' '}</span>
            </div>
          )
        })}
      </code>
    </pre>
  )
}

// 具体的 diff 展示区域。
// 它负责把单个文件的 before / after 以左右两列的形式展示出来。
function DiffPreviewArea({
  diffPreview,
  pendingSuggestion,
  isApplying,
  onApply,
  onDiscard,
}: {
  diffPreview: DiffPreview
  pendingSuggestion: PendingSuggestion | null
  isApplying: boolean
  onApply: () => void
  onDiscard: () => void
}) {
  const rows = buildDiffRows(diffPreview.before, diffPreview.after)

  return (
    <div className="diff-preview">
      <div className="diff-preview__summary">
        <h3>{diffPreview.title}</h3>
        <p>{diffPreview.summary}</p>
      </div>

      <div className="diff-grid">
        <section>
          <h4>修改前</h4>
          <DiffCodeBlock rows={rows} side="before" />
        </section>
        <section>
          <h4>修改后</h4>
          <DiffCodeBlock rows={rows} side="after" />
        </section>
      </div>

      {/* 只有当前建议还处于待审批状态时，才显示操作按钮。 */}
      {pendingSuggestion ? (
        <div className="diff-actions">
          {/* 应用修改：真正写回文件的动作发生在页面层和 localRepoService 中。 */}
          <button className="btn-apply" disabled={isApplying} type="button" onClick={onApply}>
            {isApplying ? (
              <>
                <span className="chat-send-button__spinner" />
                应用中...
              </>
            ) : (
              '应用修改'
            )}
          </button>
          {/* 放弃建议：只移除当前 suggestion，不写文件。 */}
          <button className="btn-discard" disabled={isApplying} type="button" onClick={onDiscard}>
            放弃建议
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function InspectorPanel({
  openFile,
  inspectorMode,
  diffPreviews,
  pendingSuggestions,
  activeSuggestionIndex,
  applyingSuggestionIndex,
  onModeChange,
  onActiveSuggestionChange,
  onApplySuggestion,
  onDiscardSuggestion,
}: InspectorPanelProps) {
  // 当前激活的 diff 和 suggestion 都由外层 store 控制。
  // 右侧面板自己不维护复杂状态，只负责“按当前索引把内容显示出来”。
  const activeDiffPreview = diffPreviews[activeSuggestionIndex] ?? null
  const activeSuggestion = pendingSuggestions[activeSuggestionIndex] ?? null
  const isApplyingCurrentSuggestion = applyingSuggestionIndex === activeSuggestionIndex

  // 顶部副标题会根据当前模式变化：
  // - diff 模式：展示当前建议对应的文件路径
  // - code 模式：展示当前打开文件的信息
  const subtitle =
    inspectorMode === 'diff' && activeDiffPreview
      ? `${activeDiffPreview.path} · 修改建议预览`
      : openFile
        ? `${openFile.path} · ${openFile.language}`
        : '打开一个文件以查看其内容'

  return (
    <PanelCard
      title="查看器"
      subtitle={subtitle}
      actions={<InspectorTabs mode={inspectorMode} hasDiff={diffPreviews.length > 0} onChange={onModeChange} />}
    >
      {/* diff 模式优先：如果当前确实有建议，就进入差异审阅视图。 */}
      {inspectorMode === 'diff' && activeDiffPreview ? (
        <>
          <SuggestionSwitcher
            diffPreviews={diffPreviews}
            activeSuggestionIndex={activeSuggestionIndex}
            disabled={applyingSuggestionIndex !== null}
            onChange={onActiveSuggestionChange}
          />
          <DiffPreviewArea
            diffPreview={activeDiffPreview}
            pendingSuggestion={activeSuggestion}
            isApplying={isApplyingCurrentSuggestion}
            onApply={() => {
              if (activeSuggestion) {
                void onApplySuggestion(activeSuggestionIndex, activeSuggestion)
              }
            }}
            onDiscard={() => onDiscardSuggestion(activeSuggestionIndex)}
          />
        </>
      ) : openFile ? (
        // 如果没有进入 diff 模式，但已经打开文件，就展示原始代码内容。
        <div className="code-preview">
          <div className="code-preview__meta">
            <span>{openFile.path}</span>
            <span>{openFile.language}</span>
          </div>
          <pre className="code-block"><code>{openFile.content}</code></pre>
        </div>
      ) : (
        // 两边都没有内容时，显示一个简单空状态。
        <p className="panel-empty">打开一个文件以查看其内容</p>
      )}
    </PanelCard>
  )
}
