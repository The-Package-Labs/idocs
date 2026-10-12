import { type CompiledDiagram, DEFAULT_NODE_WIDTH, type Layout } from '@the-package-labs/idocs-core'
import { useEffect, useId, useRef, useState } from 'react'
import { EdgeLayer } from './EdgeLayer'
import { NodeCard } from './NodeCard'
import { useLayout } from './useLayout'
import { Zones } from './Zones'

/** Tallest the picture may be, in px, however much room the panel has. */
const MAX_HEIGHT = 300
/** The least it is worth drawing, in px, even in a very short panel (which then scrolls). */
const MIN_HEIGHT = 110
/** What the panel spends on everything above and below the picture, in px. */
const CHROME = 160

/**
 * Layouts already computed, so selecting the same node again shows its picture at once. A diagram
 * is plain data that stays the same object for as long as the page does.
 */
const laidOut = new WeakMap<CompiledDiagram, Map<string, Layout>>()

const noop = () => {}
const noDim = () => false
const noState = () => ({})

/**
 * A picture of a whole diagram, drawn from its real layout and scaled to the width it is given:
 * what a node holds, shown in the drawer. It is for looking at, so nothing in it can be
 * focused or clicked.
 */
export function DiagramPreview({ diagram, viewId }: { diagram: CompiledDiagram; viewId: string }) {
  const view = diagram.views.find((v) => v.id === viewId) ?? diagram.views[0]!
  const uid = useId().replace(/:/g, '')
  const { layout: fresh, measureRef } = useLayout(diagram, view.id)
  const cached = laidOut.get(diagram)?.get(view.id)
  const layout = fresh ?? cached

  useEffect(() => {
    if (!fresh) return
    const byView = laidOut.get(diagram) ?? new Map<string, Layout>()
    byView.set(view.id, fresh)
    laidOut.set(diagram, byView)
  }, [fresh, diagram, view.id])

  // The picture is as wide as its box and as tall as the panel allows, so in a short canvas it
  // still fits without scrolling the panel.
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ width: 0, height: MAX_HEIGHT })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const panel = el.closest('.idocs-drawer')
    const read = () =>
      setRoom({
        width: el.clientWidth,
        height: panel
          ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, panel.clientHeight - CHROME))
          : MAX_HEIGHT,
      })
    const ro = new ResizeObserver(read)
    ro.observe(el)
    if (panel) ro.observe(panel)
    read()
    return () => ro.disconnect()
  }, [])
  const width = room.width

  const scale = layout && width ? Math.min(1, width / layout.width, room.height / layout.height) : 0
  return (
    <div
      ref={box}
      className="idocs-peek-box"
      style={{ height: layout && scale ? Math.ceil(layout.height * scale) : 96 }}
      aria-hidden="true"
    >
      {layout && scale > 0 ? (
        <div
          className="idocs-peek-world"
          style={{
            width: layout.width,
            height: layout.height,
            left: (width - layout.width * scale) / 2,
            transform: `scale(${scale})`,
          }}
        >
          <Zones diagram={diagram} groupIds={view.groupIds} layout={layout} dim={noDim} />
          <EdgeLayer
            uid={`${uid}-peek`}
            diagram={diagram}
            view={view}
            layout={layout}
            stateOf={noState}
            onHover={noop}
            register={noop}
          />
          {view.nodeIds.map((id) => {
            const r = layout.nodes[id]
            if (!r) return null
            return (
              <NodeCard
                key={id}
                node={diagram.nodes[id]!}
                preview
                style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
              />
            )
          })}
        </div>
      ) : (
        <span className="idocs-peek-wait">Drawing…</span>
      )}
      <div className="idocs-measure" ref={measureRef}>
        {view.nodeIds.map((id) => {
          const n = diagram.nodes[id]!
          return <NodeCard key={id} node={n} measure style={{ width: n.w ?? DEFAULT_NODE_WIDTH }} />
        })}
      </div>
    </div>
  )
}
