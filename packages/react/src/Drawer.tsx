import type { CompiledDiagram, CompiledView } from '@the-package-labs/idocs-core'
import { useEffect, useRef } from 'react'
import { DiagramPreview } from './DiagramPreview'
import { IconTile } from './Icon'
import { Markup } from './Markup'
import { CollapseIcon, ExpandIcon, insideCounts, LayersIcon, type NodeInside } from './NodeCard'
import { cx } from './util'

/** How wide the drawer is when there is room, in px (see `.idocs-drawer`). */
export const DRAWER_WIDTH = 360

interface Props {
  diagram: CompiledDiagram
  view: CompiledView
  nodeId: string
  /** Set when the node holds a diagram the reader can expand in place or move into. */
  inside?: NodeInside
  /** The diagram the node holds and the view to draw of it, shown as a picture at the top. */
  peek?: { diagram: CompiledDiagram; viewId: string }
  /** Whether it is shown in place right now. */
  expanded?: boolean
  onExpand?: (id: string) => void
  onOpen?: (id: string) => void
  onClose: () => void
  onSelect: (id: string) => void
}

export function Drawer({
  diagram,
  view,
  nodeId,
  inside,
  peek,
  expanded,
  onExpand,
  onOpen,
  onClose,
  onSelect,
}: Props) {
  const node = diagram.nodes[nodeId]!
  const closeRef = useRef<HTMLButtonElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: nodeId re-focuses the close button when another node opens
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, nodeId])

  const inView = new Set(view.nodeIds)
  const edges = view.edgeIds.map((id) => diagram.edges[id]!).filter((e) => !e.hidden)
  const outgoing = edges.filter((e) => e.from === nodeId || (e.both && e.to === nodeId))
  const incoming = edges.filter((e) => e.to === nodeId && !e.both)
  const other = (e: (typeof edges)[number]) => (e.from === nodeId ? e.to : e.from)
  const usesLinks = node.uses.map((u) => ({
    text: u,
    id: diagram.nodes[u] && inView.has(u) ? u : undefined,
  }))

  // Between entities the edge is about two fields, said from this node's side: `customer_id → id`
  // when it points out, `id ← customer_id` when it points in.
  const fieldsOf = (e: (typeof edges)[number]) => {
    const out = e.from === nodeId
    const mine = out ? e.fromField : e.toField
    const theirs = out ? e.toField : e.fromField
    return mine || theirs ? `${mine ?? '…'} ${out ? '→' : '←'} ${theirs ?? '…'}` : undefined
  }

  const rows = (list: typeof edges, arrow: string) =>
    list.map((e) => (
      <li key={e.id}>
        {arrow}{' '}
        <button type="button" onClick={() => onSelect(other(e))}>
          {diagram.nodes[other(e)]?.title}
        </button>
        {fieldsOf(e) ? <span> · {fieldsOf(e)}</span> : null}
        {e.label ? <span> · {e.label}</span> : null}
      </li>
    ))

  return (
    <aside className="idocs-drawer" aria-label={`${node.title} details`}>
      <div className="idocs-drawer-head">
        {node.icon && <IconTile icon={node.icon} />}
        <div className="idocs-node-titles">
          <div className="idocs-node-title">{node.title}</div>
          {node.sub && <div className="idocs-node-sub">{node.sub}</div>}
        </div>
        {node.status !== 'built' && (
          <span className={cx('idocs-pill', `st-${node.status}`)}>{node.status}</span>
        )}
        <button
          ref={closeRef}
          type="button"
          className="idocs-drawer-close"
          onClick={onClose}
          aria-label="Close details"
        >
          ×
        </button>
      </div>
      <div className="idocs-drawer-body">
        {inside && (
          <section className="idocs-peek" aria-label={`The diagram inside ${node.title}`}>
            <div className="idocs-peek-head">
              <div className="idocs-peek-title">
                <b>{peek?.diagram.title ?? inside.title}</b>
                <span>{insideCounts(inside)}</span>
              </div>
              {inside.expand && onExpand && (
                <button
                  type="button"
                  className="idocs-icon-btn"
                  aria-label={expanded ? 'Collapse' : 'Expand here'}
                  title={expanded ? 'Collapse' : 'Expand here, as a group'}
                  onClick={() => onExpand(nodeId)}
                >
                  {expanded ? <CollapseIcon /> : <ExpandIcon />}
                </button>
              )}
              {inside.open && onOpen && (
                <button
                  type="button"
                  className="idocs-icon-btn"
                  aria-label="Open"
                  title="Open, with a way back"
                  onClick={() => onOpen(nodeId)}
                >
                  <LayersIcon />
                </button>
              )}
            </div>
            {peek && !expanded && <DiagramPreview diagram={peek.diagram} viewId={peek.viewId} />}
          </section>
        )}
        {node.docHtml ? (
          <Markup className="idocs-md" html={node.docHtml} />
        ) : node.lines.length ? (
          <ul>
            {node.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        ) : (
          <p className="idocs-summary">
            No description yet. Add <code>nodes/{node.id}.md</code> next to the diagram file.
          </p>
        )}
        {node.fields.length > 0 && (
          <>
            <h4>Fields</h4>
            <ul className="idocs-drawer-fields">
              {node.fields.map((f) => (
                <li key={f.name}>
                  <div className="idocs-drawer-field">
                    <span className="idocs-field-name">
                      {f.key && <b aria-hidden="true">#</b>}
                      {f.name}
                    </span>
                    {f.type && <span className="idocs-field-type">{f.type}</span>}
                  </div>
                  {f.ref && (
                    <div className="idocs-drawer-ref">
                      →{' '}
                      {inView.has(f.ref.node) ? (
                        <button type="button" onClick={() => onSelect(f.ref!.node)}>
                          {f.ref.node}
                          {f.ref.field ? `.${f.ref.field}` : ''}
                        </button>
                      ) : (
                        `${f.ref.node}${f.ref.field ? `.${f.ref.field}` : ''}`
                      )}
                    </div>
                  )}
                  {f.note && <div className="idocs-drawer-note">{f.note}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
        {(outgoing.length > 0 || incoming.length > 0) && (
          <>
            <h4>Connections</h4>
            <ul className="idocs-drawer-links">
              {rows(outgoing, '→')}
              {rows(incoming, '←')}
            </ul>
          </>
        )}
        {usesLinks.length > 0 && (
          <>
            <h4>Uses</h4>
            <ul className="idocs-drawer-links">
              {usesLinks.map((u) => (
                <li key={u.text}>
                  {u.id ? (
                    <button type="button" onClick={() => onSelect(u.id!)}>
                      {u.text}
                    </button>
                  ) : (
                    u.text
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {node.links.length > 0 && (
          <>
            <h4>Links</h4>
            <ul className="idocs-drawer-links">
              {node.links.map((l) => (
                <li key={l.url}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--idocs-accent)' }}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        {node.refs.length > 0 && (
          <>
            <h4>Source</h4>
            <ul>
              {node.refs.map((r) => (
                <li key={r}>
                  <code>{r}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}
