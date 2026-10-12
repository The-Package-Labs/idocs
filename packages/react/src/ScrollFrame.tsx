import { useEffect, useRef, useState } from 'react'
import { FullscreenTool } from './Tools'
import { cx, keepInView, NARROW } from './util'

interface Props {
  /** The tallest the frame may be, in px; it is never shorter than it needs to hold the panel. */
  maxHeight: number
  fullscreen: boolean
  onToggleFullscreen?: () => void
  /** Buttons for the toolbar in the corner, before the full screen one. */
  tools?: React.ReactNode
  panel?: React.ReactNode
  /** How much of the left edge the open panel covers, in px; the content starts after it. */
  inset?: number
  /** Index of the step in progress: the frame scrolls to keep it in view. */
  current: number
  children: React.ReactNode
}

/**
 * The viewport for a scenario shown as a sequence or a story. Those are documents, not a
 * picture to pan, so they scroll inside the frame; the panel floats over it the way it does over
 * the canvas, and the content starts to its right.
 */
export function ScrollFrame({
  maxHeight,
  fullscreen,
  onToggleFullscreen,
  tools,
  panel,
  inset: insetProp = 0,
  current,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const inset = width >= NARROW ? insetProp : 0

  // The step in progress is a row of the sequence or a box of the story. Keep it in sight inside
  // this frame, and never scroll the page for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step in progress is the trigger
  useEffect(() => {
    const box = scroller.current
    const el = box?.querySelector<HTMLElement>('.idocs-sbox.is-active, .seq-row.is-active')
    if (el && box) keepInView(el, box, 56)
  }, [current])

  return (
    <div
      ref={ref}
      className={cx('idocs-frame', 'idocs-scrollframe', 'idocs-ui')}
      style={
        {
          '--idocs-frame-h': `${maxHeight}px`,
          '--idocs-inset': `${inset}px`,
        } as React.CSSProperties
      }
    >
      <div ref={scroller} className="idocs-scroller">
        {children}
      </div>
      <div className="idocs-toolbar">
        {tools}
        {onToggleFullscreen && (
          <div className="idocs-toolbar-group">
            <FullscreenTool fullscreen={fullscreen} onToggle={onToggleFullscreen} />
          </div>
        )}
      </div>
      {panel}
    </div>
  )
}
