import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'

// 工作区分割布局的属性类型
type WorkspaceSplitLayoutProps = {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}

// 面板位置类型
type PanelSide = 'left' | 'right'

// 布局宽度类型
type LayoutWidths = {
  left: number
  right: number
}

// 拖拽状态类型
type DragState = {
  side: PanelSide
  startX: number
  startLeftWidth: number
  startRightWidth: number
}

// 持久化存储的键名
const STORAGE_KEY = 'ai-repo-assistant.workspace-layout'
// 分割条宽度
const SPLITTER_WIDTH = 10
// 默认宽度
const DEFAULT_WIDTHS: LayoutWidths = {
  left: 280,
  right: 420,
}
// 最小宽度限制
const MIN_LEFT_WIDTH = 220
const MIN_CENTER_WIDTH = 320
const MIN_RIGHT_WIDTH = 280

// 限制数值在指定范围内
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

// 从本地存储读取已保存的宽度配置
function readStoredWidths() {
  if (typeof window === 'undefined') {
    return DEFAULT_WIDTHS
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY)

    if (!rawValue) {
      return DEFAULT_WIDTHS
    }

    const parsed = JSON.parse(rawValue) as Partial<LayoutWidths>

    if (typeof parsed.left === 'number' && typeof parsed.right === 'number') {
      return {
        left: parsed.left,
        right: parsed.right,
      }
    }
  } catch {
    // 布局持久化是可选的。如果 localStorage 失败，UI 仍会使用默认值工作
  }

  return DEFAULT_WIDTHS
}

// 此辅助函数保持左右面板在合理范围内，
// 并防止中间面板被压缩得过小
function normalizeWidths(widths: LayoutWidths, containerWidth: number) {
  const availableWidth = Math.max(containerWidth - SPLITTER_WIDTH * 2, 0)
  const minimumTotalWidth = MIN_LEFT_WIDTH + MIN_CENTER_WIDTH + MIN_RIGHT_WIDTH


  // 正常情况下的宽度计算
  const maxSideWidth = availableWidth - MIN_CENTER_WIDTH
  const maxLeftWidth = maxSideWidth - MIN_RIGHT_WIDTH
  const nextLeft = clamp(widths.left, MIN_LEFT_WIDTH, maxLeftWidth)
  const maxRightWidth = maxSideWidth - nextLeft
  const nextRight = clamp(widths.right, MIN_RIGHT_WIDTH, maxRightWidth)

  return {
    left: nextLeft,
    right: nextRight,
  }
}

export function WorkspaceSplitLayout({ left, center, right }: WorkspaceSplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  // 初始化宽度状态
  const [widths, setWidths] = useState<LayoutWidths>(() => readStoredWidths())

  // 当宽度变化时持久化到本地存储
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
    } catch {
      // 持久化宽度只是额外功能，不应阻止渲染
    }
  }, [widths])

  // 监听窗口大小变化，重新计算和规范化布局宽度,确保
  useEffect(() => {
    function syncWidthsToContainer() {
      const containerWidth = containerRef.current?.clientWidth ?? 0

      if (!containerWidth) {
        return
      }

      setWidths((currentWidths) => normalizeWidths(currentWidths, containerWidth))
    }

    syncWidthsToContainer()
    window.addEventListener('resize', syncWidthsToContainer)

    return () => {
      window.removeEventListener('resize', syncWidthsToContainer)
    }
  }, [])

  // 处理分割条拖拽事件
  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current
      const containerWidth = containerRef.current?.clientWidth ?? 0

      if (!dragState || !containerWidth) {
        return
      }

      // 计算指针移动的距离
      const deltaX = event.clientX - dragState.startX

      // 根据拖拽的分割条更新左或右面板的宽度
      if (dragState.side === 'left') {
        setWidths(
          normalizeWidths(
            {
              left: dragState.startLeftWidth + deltaX,
              right: dragState.startRightWidth,
            },
            containerWidth,
          ),
        )
        return
      }

      setWidths(
        normalizeWidths(
          {
            left: dragState.startLeftWidth,
            right: dragState.startRightWidth - deltaX,
          },
          containerWidth,
        ),
      )
    }

    // 停止拖拽
    function stopDragging() {
      dragStateRef.current = null
      document.body.classList.remove('is-resizing-panels')
    }
    //拖拽移动
    window.addEventListener('pointermove', handlePointerMove)
    
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [])

  // 开始拖拽分割条
  function startDragging(side: PanelSide, event: ReactPointerEvent<HTMLDivElement>) {
    const containerWidth = containerRef.current?.clientWidth ?? 0

    if (!containerWidth) {
      return
    }

    dragStateRef.current = {
      side,
      startX: event.clientX,
      startLeftWidth: widths.left,
      startRightWidth: widths.right,
    }

    // 添加视觉反馈：显示正在调整大小
    document.body.classList.add('is-resizing-panels')
  }

  return (
    <div ref={containerRef} className="workspace-grid">
      {/* 左侧面板 */}
      <div className="workspace-column workspace-column--left" style={{ width: `${widths.left}px` }}>
        {left}
      </div>

      {/* 左侧分割条 */}
      <div
        aria-label="Resize repository panel"
        className="workspace-splitter"
        role="separator"
        tabIndex={0}
        onPointerDown={(event) => startDragging('left', event)}
      />

      {/* 中间面板 */}
      <div className="workspace-column workspace-column--center">{center}</div>

      {/* 右侧分割条 */}
      <div
        aria-label="Resize inspector panel"
        className="workspace-splitter"
        role="separator"
        tabIndex={0}
        onPointerDown={(event) => startDragging('right', event)}
      />

      {/* 右侧面板 */}
      <div className="workspace-column workspace-column--right" style={{ width: `${widths.right}px` }}>
        {right}
      </div>
    </div>
  )
}