import type { CompiledDiagram, CompiledView } from '@the-package-labs/idocs-core'
import { useEffect, useRef } from 'react'
import { IconTile } from './Icon'
import { CollapseIcon, ExpandIcon, insideSummary, LayersIcon, type NodeInside } from './NodeCard'
import { cx } from './util'

interface Props {
  diagram: CompiledDiagram
  view: CompiledView
  nodeId: string
  /** Set when the node holds a diagram the reader can expand in place or move into. */
  inside?: NodeInside
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

  const rows = (list: typeof edges, arrow: string) =>
    list.map((e) => (
      <li key={e.id}>
        {arrow}{' '}
        <button type="button" onClick={() => onSelect(other(e))}>
          {diagram.nodes[other(e)]?.title}
        </button>
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
        {inside && ((inside.expand && onExpand) || (inside.open && onOpen)) && (
          <div className="idocs-actions">
            {inside.expand && onExpand && (
              <button type="button" className="idocs-open" onClick={() => onExpand(nodeId)}>
                <span className="idocs-open-icon">
                  {expanded ? <CollapseIcon /> : <ExpandIcon />}
                </span>
                <span className="idocs-open-text">
                  <b>{expanded ? 'Collapse' : 'Expand here'}</b>
                  <span>
                    {expanded ? 'Fold it back into one card' : 'Show it in place, as a group'}
                  </span>
                </span>
              </button>
            )}
            {inside.open && onOpen && (
              <button type="button" className="idocs-open" onClick={() => onOpen(nodeId)}>
                <span className="idocs-open-icon">
                  <LayersIcon />
                </span>
                <span className="idocs-open-text">
                  <b>{inside.expand ? 'Open' : 'Look inside'}</b>
                  <span>{insideSummary(inside)}</span>
                </span>
                <span className="idocs-open-go" aria-hidden="true">
                  ›
                </span>
              </button>
            )}
          </div>
        )}
        {node.docHtml ? (
          <div className="idocs-md" dangerouslySetInnerHTML={{ __html: node.docHtml }} />
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
