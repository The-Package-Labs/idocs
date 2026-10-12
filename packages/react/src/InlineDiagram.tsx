import type {
  CompiledDiagram,
  CompiledNode,
  CompiledView,
  Diagrams,
  InnerLayout,
  Rect,
} from '@the-package-labs/idocs-core'
import { memo, useCallback, useMemo, useState } from 'react'
import { EdgeLayer, type EdgeState } from './EdgeLayer'
import { focusOf, type Hover } from './focus'
import { IconTile } from './Icon'
import { insideOf } from './inside'
import { CollapseIcon, LayersIcon, NodeCard, type NodeCardState, type NodeInside } from './NodeCard'
import { cx } from './util'
import { Zones } from './Zones'

interface Props {
  uid: string
  /** The path of the node that is expanded: `orders`, or `orders/stock` inside it. */
  path: string
  node: CompiledNode
  rect: Rect
  /** The diagram shown in place, its view and how it is laid out. */
  child: CompiledDiagram
  view: CompiledView
  inner: InnerLayout
  diagrams: Diagrams
  /** What the outer diagram says about this node: selected, highlighted, faded, visited. */
  state?: NodeCardState
  inside: NodeInside
  /** The path of the selected node, anywhere in the diagram. */
  selected: string | null
  hidePlanned: boolean
  onSelect: (path: string) => void
  onToggle: (path: string) => void
  onOpen?: (path: string) => void
}

const noRegister = () => {}
const noDim = () => false

/**
 * A node shown in place: a group with the node's name on top and its whole diagram inside. The
 * diagram is drawn from its own layout at its own size, so nothing in it is scaled, and the card
 * pieces are the ordinary ones. Inside, nodes can themselves be expanded.
 */
export const InlineDiagram = memo(function InlineDiagram({
  uid,
  path,
  node,
  rect,
  child,
  view,
  inner,
  diagrams,
  state = {},
  inside,
  selected,
  hidePlanned,
  onSelect,
  onToggle,
  onOpen,
}: Props) {
  const [hover, setHover] = useState<Hover>({})
  const prefix = `${path}/`
  const layout = inner.layout.layout

  const onHoverNode = useCallback(
    (p: string | null) => setHover(p ? { node: p.slice(prefix.length) } : {}),
    [prefix],
  )
  const onHoverEdge = useCallback((id: string | null) => setHover(id ? { edge: id } : {}), [])
  // A card that is replaced under the pointer never says the pointer left it.
  const toggle = useCallback(
    (p: string) => {
      setHover({})
      onToggle(p)
    },
    [onToggle],
  )

  const focus = useMemo(() => focusOf(child, view, hover), [child, view, hover])
  const hiddenEdge = useCallback(
    (id: string) => {
      const e = child.edges[id]!
      return (
        hidePlanned &&
        (e.status === 'planned' ||
          child.nodes[e.from]!.status === 'planned' ||
          child.nodes[e.to]!.status === 'planned')
      )
    },
    [child, hidePlanned],
  )
  const stateOf = useCallback(
    (id: string): EdgeState => ({
      hl: !!focus?.edges.has(id),
      dim: focus ? !focus.edges.has(id) : false,
      hidden: hiddenEdge(id),
    }),
    [focus, hiddenEdge],
  )
  const flagsOf = (id: string): NodeCardState => ({
    selected: selected === `${prefix}${id}`,
    hl: !!focus?.nodes.has(id),
    dim: focus ? !focus.nodes.has(id) : false,
    hidden: hidePlanned && child.nodes[id]!.status === 'planned',
  })

  return (
    <div
      className={cx(
        'idocs-inline',
        node.family && `fam-${node.family}`,
        `st-${node.status}`,
        state.selected && 'is-selected',
        state.hl && 'is-hl',
        state.dim && 'is-dim',
        state.visited && 'is-visited',
        state.origin && 'is-origin',
      )}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      data-node={path}
      data-inline=""
    >
      <div className="idocs-inline-head">
        <button
          type="button"
          className="idocs-inline-title"
          aria-label={`${node.title}${node.sub ? `, ${node.sub}` : ''}. Open details`}
          onClick={() => onSelect(path)}
        >
          {node.icon && <IconTile icon={node.icon} />}
          <span className="idocs-node-titles">
            <span className="idocs-node-title">{node.title}</span>
            {node.sub && <span className="idocs-node-sub">{node.sub}</span>}
          </span>
        </button>
        <button
          type="button"
          className="idocs-inline-act"
          onClick={() => toggle(path)}
          aria-label={`Collapse ${node.title}`}
          title="Collapse"
        >
          <CollapseIcon />
        </button>
        {inside.open && onOpen && (
          <button
            type="button"
            className="idocs-inline-act"
            onClick={() => onOpen(path)}
            aria-label={`Open ${node.title}`}
            title="Open, with a way back"
          >
            <LayersIcon />
          </button>
        )}
      </div>
      <div
        className="idocs-inline-body"
        style={{
          left: inner.offset.x,
          top: inner.offset.y,
          width: layout.width,
          height: layout.height,
        }}
      >
        <Zones diagram={child} groupIds={view.groupIds} layout={layout} dim={noDim} />
        <EdgeLayer
          uid={`${uid}-${path.replace(/\//g, '_')}`}
          diagram={child}
          view={view}
          layout={layout}
          stateOf={stateOf}
          onHover={onHoverEdge}
          register={noRegister}
        />
        {view.nodeIds.map((id) => {
          const r = layout.nodes[id]
          if (!r) return null
          const childPath = `${prefix}${id}`
          const here = inner.layout.inner[id]
          const holds = insideOf(child.nodes[id]!, diagrams, !!onOpen)
          if (here && holds) {
            const target = diagrams[here.name]!
            return (
              <InlineDiagram
                key={id}
                uid={uid}
                path={childPath}
                node={child.nodes[id]!}
                rect={r}
                child={target}
                view={target.views.find((v) => v.id === here.viewId)!}
                inner={here}
                diagrams={diagrams}
                state={flagsOf(id)}
                inside={holds}
                selected={selected}
                hidePlanned={hidePlanned}
                onSelect={onSelect}
                onToggle={toggle}
                onOpen={onOpen}
              />
            )
          }
          return (
            <NodeCard
              key={id}
              node={child.nodes[id]!}
              path={childPath}
              style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
              state={flagsOf(id)}
              inside={holds}
              onSelect={onSelect}
              onExpand={toggle}
              onOpen={onOpen}
              onHover={onHoverNode}
            />
          )
        })}
      </div>
    </div>
  )
})
