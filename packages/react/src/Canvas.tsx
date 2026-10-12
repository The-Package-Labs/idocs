import type { Layout, Rect } from '@the-package-labs/idocs-core'
import { select } from 'd3-selection'
import 'd3-transition'
import { type ZoomBehavior, zoom, zoomIdentity, zoomTransform } from 'd3-zoom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from './util'

const PAD = 28

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

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const aspect = (layout.height + PAD * 2) / (layout.width + PAD * 2)
  const height = Math.min(maxHeight, Math.max(300, Math.round(width * aspect)))

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
        return !(event.target as Element).closest('.idocs-toolbar, .idocs-drawer')
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
    const k = Math.min((w - PAD * 2) / layout.width, (h - PAD * 2) / layout.height, 1.2)
    const x = (w - layout.width * k) / 2
    const y = (h - layout.height * k) / 2
    select(el).call(zb.transform, zoomIdentity.translate(x, y).scale(k))
    moved.current = false
    fitted.current = true
  }, [layout])

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
    const fitK = Math.min((w - PAD * 2) / layout.width, (h - PAD * 2) / layout.height, 1.2)
    const k = Math.max(fitK, Math.min(1.1, (w - margin) / r.w, (h - margin) / r.h))
    const x = w / 2 - (r.x + r.w / 2) * k
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

  return (
    <div
      ref={frameRef}
      className={cx('idocs-frame', 'idocs-ui')}
      style={fullscreen ? undefined : { height }}
      onClick={(e) => {
        if (
          e.target === e.currentTarget ||
          (e.target as Element).closest('.idocs-world') === worldRef.current
        ) {
          // A card, or the header of a node shown in place, is something to act on, not background.
          if (!(e.target as Element).closest('.idocs-node, .idocs-inline-head'))
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
          {onToggleFullscreen && (
            <button
              type="button"
              className="idocs-tool"
              title={fullscreen ? 'Exit full screen' : 'Full screen'}
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              onClick={onToggleFullscreen}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {fullscreen ? (
                  <path d="M13.5 6.5H9.5v-4M9.5 6.5l4.5-4.5M2.5 9.5h4v4M6.5 9.5L2 14" />
                ) : (
                  <path d="M9.5 2.5h4v4M13.5 2.5l-5 5M6.5 13.5h-4v-4M2.5 13.5l5-5" />
                )}
              </svg>
            </button>
          )}
        </div>
      </div>
      {overlay}
    </div>
  )
}
