import type { CompiledDiagram, CompiledView } from '@the-package-labs/idocs-core'
import { useId } from 'react'
import { Chevron } from './Folding'
import { cx } from './util'

interface Props {
  diagram: CompiledDiagram
  view: CompiledView
  hover: string | null
  onHover: (edgeId: string | null) => void
  /** The table is listed; closed, only its bar is. */
  open: boolean
  onToggle: () => void
}

/**
 * The connections of the view as a table, under a bar that folds it away: it is a reference to
 * reach for, not part of the picture, so it starts folded and the reader opens it.
 */
export function InterfaceTable({ diagram, view, hover, onHover, open, onToggle }: Props) {
  const uid = useId().replace(/:/g, '')
  const edges = view.edgeIds.map((id) => diagram.edges[id]!).filter((e) => !e.hidden)
  if (edges.length === 0) return null
  const title = (id: string) => diagram.nodes[id]?.title ?? id
  return (
    <section className={cx('idocs-ifaces', open && 'is-open')} aria-label="Interfaces">
      <button
        type="button"
        className="idocs-ifaces-head"
        aria-expanded={open}
        aria-controls={`${uid}-table`}
        title={open ? 'Fold the interfaces away' : 'Show the interfaces'}
        onClick={onToggle}
      >
        <Chevron open={open} />
        <span className="idocs-ifaces-title">Interfaces</span>
        <span className="idocs-ifaces-count">
          {edges.length} connection{edges.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div id={`${uid}-table`} className="idocs-table-wrap">
          <table className="idocs-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>From → To</th>
                <th>Kind</th>
                <th>Auth</th>
                <th>What travels</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((e) => (
                <tr
                  key={e.id}
                  className={cx(hover === e.id && 'is-hl')}
                  onMouseEnter={() => onHover(e.id)}
                  onMouseLeave={() => onHover(null)}
                >
                  <td>{view.keys[e.id] ?? ''}</td>
                  <td>
                    {title(e.from)} {e.both ? '↔' : '→'} {title(e.to)}
                  </td>
                  <td>
                    <span className="idocs-kind-tag">{e.kind}</span>
                  </td>
                  <td>{e.auth ?? '—'}</td>
                  <td>{e.payload ?? e.label ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
