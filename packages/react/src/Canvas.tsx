import type { Layout, Rect } from '@the-package-labs/idocs-core'
import { select } from 'd3-selection'
import 'd3-transition'
import { type ZoomBehavior, zoom, zoomIdentity, zoomTransform } from 'd3-zoom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FullscreenTool } from './Tools'
import { cx, NARROW } from './util'

const PAD = 28
/** The shortest the reader can make the viewer, and the tallest, in px. */
const MIN_HEIGHT = 220
const MAX_HEIGHT = 3000
/** How much of the window an expanded viewer takes. */
const EXPANDED = 0.88
/** What the arrow keys and Page Up/Down move the bottom edge by, in px. */
const STEP = 24
const PAGE = 120
/** The zoom a camera that only says "here it is" does not go below, so cards stay readable. */
const KEEP_AT_LEAST = 0.75

export interface Focus {
  /** Changes whenever the camera should move; the rect is what to bring into view. */
  key: string
  rect: Rect
  /**
   * Something that was at `from` is now at `to`, because the layout changed under the reader
   * (a node was expanded or folded). The camera first moves so that it stays where it was on
   * screen, then glides to `rect`, so the change reads as one movement and not a jump.
   */
  anchor?: { from: Rect; to: Rect }
  /**
   * Only bring the rectangle to the middle of what is in view, and keep the zoom the reader has
   * (but never smaller than a readable size). For "show me where this is".
   */
  keep?: boolean
}

interface Props {
  layout: Layout
  maxHeight: number
  fullscreen: boolean
  /** Absent where the page may not go full screen (an iframe without permission), which hides the button. */
  onToggleFullscreen?: () => void
  /** Rendered inside the transformed world, in layout coordinates. */
  children: React.ReactNode
  /** Rendered over the frame, untransformed (drawer). */
  overlay?: React.ReactNode
  /**
   * The panel that floats over the left of the frame (outline, scenarios, player). It takes no part
   * in panning and zooming.
   */
  panel?: React.ReactNode
  /**
   * How much of the frame's left edge the panel covers right now, in px. The picture is fitted to
   * what is left, and words that centre on the frame centre on that instead.
   */
  inset?: number
  /**
   * What the panel covers when it is open, in px, even while it is folded: the frame is sized for
   * it, so folding the panel does not make the page jump.
   */
  reserve?: number
  /** How much of the right edge the drawer covers right now, in px: the camera centres on the rest. */
  insetRight?: number
  /** Words over the bottom of the frame, centred: what the scenario is doing right now. */
  subtitle?: React.ReactNode
  /** The shortest the frame may be, however it is sized, in px. Default 220. */
  minHeight?: number
  tools?: React.ReactNode
  onBackgroundClick?: () => void
  /** When set, the camera glides to this rectangle whenever its key changes. */
  focus?: Focus | null
  /** Called when the reader pans or zooms by hand. */
  onUserMove?: () => void
}

export function Canvas({
  layout,
  maxHeight,
  fullscreen,
  onToggleFullscreen,
  children,
  overlay,
  panel,
  inset: insetProp = 0,
  reserve = 0,
  insetRight = 0,
  subtitle,
  minHeight = MIN_HEIGHT,
  tools,
  onBackgroundClick,
  focus,
  onUserMove,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const behavior = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null)
  const moved = useRef(false)
  // The first fit has happened, and the focus the camera last moved for.
  const fitted = useRef(false)
  const appliedFocus = useRef<string | undefined>(undefined)
  const userMove = useRef(onUserMove)
  userMove.current = onUserMove
  const [width, setWidth] = useState(0)
  // The reader's say over the height: a size they dragged to, or the whole of the window.
  const [custom, setCustom] = useState<number | null>(null)
  const [grown, setGrown] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [windowHeight, setWindowHeight] = useState(0)
  useEffect(() => {
    const read = () => setWindowHeight(window.innerHeight)
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // A frame too narrow to share with the panel lets the panel cover the picture instead.
  const roomy = width >= NARROW
  const inset = roomy ? insetProp : 0
  const aspect = (layout.height + PAD * 2) / (layout.width + PAD * 2)
  const room = Math.max(120, width - (roomy ? reserve : 0))
  const auto = Math.min(maxHeight, Math.max(Math.max(300, minHeight), Math.round(room * aspect)))
  const expandedHeight = Math.max(auto, Math.round(windowHeight * EXPANDED))
  const height = custom ?? (grown ? expandedHeight : auto)

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const settle = 0
    const zb = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.15, 3])
      .filter((event: Event) => {
        if (event.type === 'wheel')
          return (event as WheelEvent).ctrlKey || (event as WheelEvent).metaKey
        if (event.type === 'dblclick') return false
        if (event.type.startsWith('touch')) return (event as TouchEvent).touches.length >= 2
        if ((event as MouseEvent).button) return false
        return !(event.target as Element).closest(
          '.idocs-toolbar, .idocs-drawer, .idocs-resize, .idocs-panel',
        )
      })
      .on('zoom', (e) => {
        const t = e.transform
        if (worldRef.current)
          worldRef.current.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`
        if (e.sourceEvent) {
          moved.current = true
          userMove.current?.()
        }
      })
    behavior.current = zb
    select(el).call(zb)
    return () => {
      window.clearTimeout(settle)
      select(el).on('.zoom', null)
    }
  }, [])

  const fit = useCallback(() => {
    const el = frameRef.current
    const zb = behavior.current
    if (!el || !zb) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (!w || !h) return
    const free = w - inset
    const k = Math.min((free - PAD * 2) / layout.width, (h - PAD * 2) / layout.height, 1.2)
    const x = inset + (free - layout.width * k) / 2
    const y = (h - layout.height * k) / 2
    select(el).call(zb.transform, zoomIdentity.translate(x, y).scale(k))
    moved.current = false
    fitted.current = true
  }, [layout, inset])

  const focusKey = focus?.key

  // Re-fit on any size change until the reader has panned or zoomed by hand. Not while a glide to
  // a new focus is about to start: it carries on from the camera as it is, and fitting first
  // would make the picture jump and then move again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: width, height and fullscreen are the triggers
  useLayoutEffect(() => {
    if (moved.current) return
    if (fitted.current && focusKey !== undefined && focusKey !== appliedFocus.current) return
    fit()
  }, [fit, width, height, fullscreen])

  // The layout changed under the reader: keep what they were looking at where it was on screen,
  // before the first frame is drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger
  useLayoutEffect(() => {
    const el = frameRef.current
    const zb = behavior.current
    const anchor = focus?.anchor
    if (!anchor || !el || !zb || focusKey === appliedFocus.current) return
    const t = zoomTransform(el)
    const sx = t.x + anchor.from.x * t.k
    const sy = t.y + anchor.from.y * t.k
    select(el).call(
      zb.transform,
      zoomIdentity.translate(sx - anchor.to.x * t.k, sy - anchor.to.y * t.k).scale(t.k),
    )
  }, [focusKey])

  // Glide to the focus rectangle. Never zoom in past a readable size, never out past the fit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger
  useEffect(() => {
    const el = frameRef.current
    const zb = behavior.current
    if (!focus || !el || !zb) return
    // Even with no size to glide in yet: a fit must not wait for a glide that will not come.
    appliedFocus.current = focusKey
    const w = el.clientWidth
    const h = el.clientHeight
    if (!w || !h) return
    const r = focus.rect
    const margin = 90
    const free = w - inset
    const fitK = Math.min((free - PAD * 2) / layout.width, (h - PAD * 2) / layout.height, 1.2)
    const k = focus.keep
      ? Math.max(zoomTransform(el).k, Math.min(KEEP_AT_LEAST, 1.1))
      : Math.max(fitK, Math.min(1.1, (free - margin) / r.w, (h - margin) / r.h))
    // The middle of what neither the panel nor the drawer covers.
    const seen = focus.keep && w - inset - insetRight > 200 ? w - inset - insetRight : free
    const x = inset + seen / 2 - (r.x + r.w / 2) * k
    const y = h / 2 - (r.y + r.h / 2) * k
    const target = zoomIdentity.translate(x, y).scale(k)
    select(el).transition().duration(650).call(zb.transform, target)
  }, [focusKey])

  const zoomBy = (factor: number) => {
    const el = frameRef.current
    const zb = behavior.current
    if (el && zb) select(el).call(zb.scaleBy, factor)
    moved.current = true
    userMove.current?.()
  }

  const clampHeight = (h: number) => Math.min(MAX_HEIGHT, Math.max(minHeight, Math.round(h)))
  const setHeightBy = (h: number) => {
    setGrown(false)
    setCustom(clampHeight(h))
  }
  const toggleGrown = () => {
    setCustom(null)
    setGrown((g) => !g)
    // Growing can push the bottom edge off screen: keep the viewer in sight.
    requestAnimationFrame(() => frameRef.current?.scrollIntoView({ block: 'nearest' }))
  }
  const drag = useRef<{ y: number; h: number } | null>(null)
  // The border box, which is what `height` sets: `clientHeight` leaves out the border.
  const current = () => frameRef.current?.offsetHeight ?? height

  return (
    <div
      ref={frameRef}
      className={cx('idocs-frame', 'idocs-ui', resizing && 'is-resizing')}
      style={
        {
          ...(fullscreen ? undefined : { height }),
          '--idocs-inset': `${inset}px`,
        } as React.CSSProperties
      }
      onClick={(e) => {
        if (
          e.target === e.currentTarget ||
          (e.target as Element).closest('.idocs-world') === worldRef.current
        ) {
          // A card, or the header of a node shown in place, is something to act on, not background.
          if (!(e.target as Element).closest('.idocs-node, .idocs-inline-head, .idocs-resize'))
            onBackgroundClick?.()
        }
      }}
    >
      <div
        ref={worldRef}
        className="idocs-world"
        style={{ width: layout.width, height: layout.height }}
      >
        {children}
      </div>
      <div className="idocs-toolbar">
        {tools}
        <div className="idocs-toolbar-group">
          <button
            type="button"
            className="idocs-tool"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.3)}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M3.5 8h9" />
            </svg>
          </button>
          <button
            type="button"
            className="idocs-tool"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.3)}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M3.5 8h9M8 3.5v9" />
            </svg>
          </button>
          <button
            type="button"
            className="idocs-tool"
            title="Fit to view"
            aria-label="Fit to view"
            onClick={fit}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 5.5V3a.5.5 0 0 1 .5-.5h2.5M10.5 2.5H13a.5.5 0 0 1 .5.5v2.5M13.5 10.5V13a.5.5 0 0 1-.5.5h-2.5M5.5 13.5H3a.5.5 0 0 1-.5-.5v-2.5M6 6h4v4H6z" />
            </svg>
          </button>
          {!fullscreen && (
            <button
              type="button"
              className="idocs-tool"
              title={grown ? 'Shrink the viewer' : 'Expand the viewer'}
              aria-label={grown ? 'Shrink the viewer' : 'Expand the viewer'}
              aria-pressed={grown}
              onClick={toggleGrown}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {grown ? (
                  <path d="M2.5 8h11M5.5 2.5 8 5l2.5-2.5M5.5 13.5 8 11l2.5 2.5" />
                ) : (
                  <path d="M8 2.5v11M5.5 5 8 2.5 10.5 5M5.5 11 8 13.5l2.5-2.5" />
                )}
              </svg>
            </button>
          )}
          {onToggleFullscreen && (
            <FullscreenTool fullscreen={fullscreen} onToggle={onToggleFullscreen} />
          )}
        </div>
      </div>
      {subtitle && <div className="idocs-subtitles">{subtitle}</div>}
      {panel}
      {overlay}
      {!fullscreen && (
        // The bottom edge is a splitter: drag it, or use the arrow keys; double-click puts it back.
        <div
          className="idocs-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the viewer"
          aria-valuemin={minHeight}
          aria-valuemax={MAX_HEIGHT}
          aria-valuenow={height}
          tabIndex={0}
          title="Drag to resize, double-click to reset"
          onPointerDown={(e) => {
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { y: e.clientY, h: current() }
            setResizing(true)
          }}
          onPointerMove={(e) => {
            if (drag.current) setHeightBy(drag.current.h + e.clientY - drag.current.y)
          }}
          onPointerUp={() => {
            drag.current = null
            setResizing(false)
          }}
          onPointerCancel={() => {
            drag.current = null
            setResizing(false)
          }}
          onDoubleClick={() => {
            setCustom(null)
            setGrown(false)
          }}
          onKeyDown={(e) => {
            const by: Record<string, number> = {
              ArrowUp: -STEP,
              ArrowDown: STEP,
              PageUp: -PAGE,
              PageDown: PAGE,
            }
            if (e.key in by) setHeightBy(current() + by[e.key]!)
            else if (e.key === 'Home') setHeightBy(minHeight)
            else if (e.key === 'End') setHeightBy(Math.max(minHeight, expandedHeight))
            else if (e.key === 'Enter' || e.key === 'Escape') {
              setCustom(null)
              setGrown(false)
              return
            } else return
            e.preventDefault()
          }}
        />
      )}
    </div>
  )
}
