import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'

type WorkspaceSplitLayoutProps = {
  left: ReactNode
  center: ReactNode
  right: ReactNode
}

type PanelSide = 'left' | 'right'

type LayoutWidths = {
  left: number
  right: number
}

type DragState = {
  side: PanelSide
  startX: number
  startLeftWidth: number
  startRightWidth: number
}

const STORAGE_KEY = 'ai-repo-assistant.workspace-layout'
const SPLITTER_WIDTH = 10
const DEFAULT_WIDTHS: LayoutWidths = {
  left: 280,
  right: 420,
}
const MIN_LEFT_WIDTH = 220
const MIN_CENTER_WIDTH = 320
const MIN_RIGHT_WIDTH = 280

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

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
    // Layout persistence is optional. If localStorage fails, the UI still works with defaults.
  }

  return DEFAULT_WIDTHS
}

// This helper keeps the left and right panels within sensible bounds,
// and protects the center panel from being squeezed too far.
function normalizeWidths(widths: LayoutWidths, containerWidth: number) {
  const availableWidth = Math.max(containerWidth - SPLITTER_WIDTH * 2, 0)
  const minimumTotalWidth = MIN_LEFT_WIDTH + MIN_CENTER_WIDTH + MIN_RIGHT_WIDTH

  if (availableWidth <= minimumTotalWidth) {
    const centerWidth = Math.min(MIN_CENTER_WIDTH, Math.max(Math.floor(availableWidth * 0.42), 240))
    const sideWidth = Math.max(availableWidth - centerWidth, 0)
    const sideTotal = widths.left + widths.right || DEFAULT_WIDTHS.left + DEFAULT_WIDTHS.right
    const leftRatio = sideTotal > 0 ? widths.left / sideTotal : 0.4
    const nextLeft = Math.round(sideWidth * leftRatio)

    return {
      left: Math.max(nextLeft, 0),
      right: Math.max(sideWidth - nextLeft, 0),
    }
  }

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
  const [widths, setWidths] = useState<LayoutWidths>(() => readStoredWidths())

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
    } catch {
      // Persisting widths is just a bonus and should never block rendering.
    }
  }, [widths])

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

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current
      const containerWidth = containerRef.current?.clientWidth ?? 0

      if (!dragState || !containerWidth) {
        return
      }

      const deltaX = event.clientX - dragState.startX

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

    function stopDragging() {
      dragStateRef.current = null
      document.body.classList.remove('is-resizing-panels')
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDragging)
    window.addEventListener('pointercancel', stopDragging)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDragging)
      window.removeEventListener('pointercancel', stopDragging)
    }
  }, [])

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

    document.body.classList.add('is-resizing-panels')
  }

  return (
    <div ref={containerRef} className="workspace-grid">
      <div className="workspace-column workspace-column--left" style={{ width: `${widths.left}px` }}>
        {left}
      </div>

      <div
        aria-label="Resize repository panel"
        className="workspace-splitter"
        role="separator"
        tabIndex={0}
        onPointerDown={(event) => startDragging('left', event)}
      />

      <div className="workspace-column workspace-column--center">{center}</div>

      <div
        aria-label="Resize inspector panel"
        className="workspace-splitter"
        role="separator"
        tabIndex={0}
        onPointerDown={(event) => startDragging('right', event)}
      />

      <div className="workspace-column workspace-column--right" style={{ width: `${widths.right}px` }}>
        {right}
      </div>
    </div>
  )
}