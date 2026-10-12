import type {
  EdgeKindDef,
  OutlineConnection,
  OutlineGroup,
  OutlineItem,
  OutlineNode,
} from '@the-package-labs/idocs-core'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Chevron, FoldAll, UnfoldAll } from './Folding'
import { IconTile } from './Icon'
import { CollapseIcon, ExpandIcon, LayersIcon } from './NodeCard'
import { colorVar, cx, keepInView } from './util'

interface Props {
  items: OutlineItem[]
  /** Colours of the edge kinds, for the arrows of the connections. */
  kinds: Record<string, EdgeKindDef>
  /** The path of the node that is selected. */
  selected: string | null
  /** The path of the node the pointer is on, in the picture. */
  hovered: string | null
  /** Select a node by path: the picture then moves to it and its details open. */
  onSelect: (path: string) => void
  /** Point at a node (or at nothing) and at a connection, so the picture can light it up. */
  onHoverNode: (path: string | null) => void
  onHoverEdge: (id: string | null) => void
  /** Show a node's diagram in place, or fold it away. */
  onExpand?: (path: string) => void
  onOpen?: (path: string) => void
}

type Row =
  | { type: 'group'; key: string; level: number; ancestors: string[]; group: OutlineGroup }
  | { type: 'node'; key: string; level: number; ancestors: string[]; node: OutlineNode }
  | {
      type: 'edge'
      key: string
      level: number
      ancestors: string[]
      node: OutlineNode
      edge: OutlineConnection
    }

/** The whole tree as rows, each knowing the rows above it, so folding is a filter. */
function flatten(items: OutlineItem[], level = 0, ancestors: string[] = []): Row[] {
  const rows: Row[] = []
  for (const item of items) {
    if (item.type === 'group') {
      rows.push({ type: 'group', key: item.path, level, ancestors, group: item })
      rows.push(...flatten(item.items, level + 1, [...ancestors, item.path]))
      continue
    }
    rows.push({ type: 'node', key: item.path, level, ancestors, node: item })
    const below = [...ancestors, item.path]
    rows.push(...flatten(item.inside?.items ?? [], level + 1, below))
    for (const edge of item.connections) {
      rows.push({
        type: 'edge',
        key: `${item.path}>${edge.edge}`,
        level: level + 1,
        ancestors: below,
        node: item,
        edge,
      })
    }
  }
  return rows
}

const ARROW = { out: '→', in: '←', both: '↔' }
const DIR = { out: 'to', in: 'from', both: 'with' }

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * The diagram as a tree: groups hold their nodes, a node holds its connections (and, when it is
 * shown in place, the nodes of the diagram inside it). Pointing at a row lights up the node or
 * connection in the picture, and choosing one moves the picture to it.
 *
 * Folding is local to the tree and never touches the picture. Everything starts open.
 */
export function Outline({
  items,
  kinds,
  selected,
  hovered,
  onSelect,
  onHoverNode,
  onHoverEdge,
  onExpand,
  onOpen,
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  // What the reader folded: groups, and nodes whose connections are put away.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  // The row that is in the tab order, and so the one the reader comes back to: where focus last was.
  const [cursor, setCursor] = useState<string | null>(null)
  const rows = useMemo(() => flatten(items), [items])
  const visible = useMemo(
    () => rows.filter((r) => r.ancestors.every((a) => !folded.has(a))),
    [rows, folded],
  )
  const tabStop = visible.some((r) => r.key === cursor) ? cursor : visible[0]?.key
  const nodes = rows.filter((r) => r.type === 'node').length
  // An edge is listed under both of its nodes, and is one connection. Edge ids repeat from one
  // diagram shown in place to the next, so they are counted with the path of the diagram.
  const edges = new Set(
    rows.flatMap((r) =>
      r.type === 'edge'
        ? [r.node.path.slice(0, r.node.path.length - r.node.id.length) + r.edge.edge]
        : [],
    ),
  ).size
  const foldable = useMemo(
    () => rows.filter((r) => r.type === 'group' || hasChildren(r)).map((r) => r.key),
    [rows],
  )

  // Whatever is selected, wherever the selection came from, is shown: its rows are unfolded and
  // scrolled into view inside the panel.
  useEffect(() => {
    if (!selected) return
    const row = rows.find((r) => r.type === 'node' && r.key === selected)
    if (!row) return
    const hidden = [...row.ancestors, row.key].filter((k) => folded.has(k))
    if (hidden.length) {
      setFolded((cur) => new Set([...cur].filter((k) => !hidden.includes(k))))
      return
    }
    const el = root.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(row.key)}"]`)
    const box = el?.closest<HTMLElement>('.idocs-panel-body')
    if (el && box) keepInView(el, box)
  }, [selected, rows, folded])

  const toggle = (key: string) =>
    setFolded((cur) => {
      const next = new Set(cur)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const activate = (row: Row) => {
    if (row.type === 'group') toggle(row.key)
    else if (row.type === 'node') onSelect(row.node.path)
    else
      onSelect(
        `${row.node.path.slice(0, row.node.path.length - row.node.id.length)}${row.edge.other}`,
      )
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = (e.target as HTMLElement).closest<HTMLElement>('[data-row]')
    if (!at) return
    const index = visible.findIndex((r) => r.key === at.dataset.row)
    const row = visible[index]
    if (!row) return
    const focus = (i: number) => {
      const next = visible[Math.max(0, Math.min(visible.length - 1, i))]
      if (!next) return
      root.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(next.key)}"]`)?.focus()
    }
    const open = !folded.has(row.key)
    const openable = row.type === 'group' || (row.type === 'node' && hasChildren(row))
    switch (e.key) {
      case 'ArrowDown':
        focus(index + 1)
        break
      case 'ArrowUp':
        focus(index - 1)
        break
      case 'Home':
        focus(0)
        break
      case 'End':
        focus(visible.length - 1)
        break
      case 'ArrowRight':
        if (openable && !open) toggle(row.key)
        else focus(index + 1)
        break
      case 'ArrowLeft':
        if (openable && open) toggle(row.key)
        else {
          const parent = row.ancestors[row.ancestors.length - 1]
          const i = visible.findIndex((r) => r.key === parent)
          if (i >= 0) focus(i)
        }
        break
      case 'Enter':
      case ' ':
        activate(row)
        break
      default:
        return
    }
    e.preventDefault()
  }

  if (rows.length === 0) return <p className="idocs-ol-empty">Nothing in this view.</p>

  return (
    <div ref={root} className="idocs-ol">
      <div className="idocs-ol-bar">
        <span className="idocs-ol-count">
          {count(nodes, 'node')}
          {edges ? ` · ${count(edges, 'connection')}` : ''}
        </span>
        <button
          type="button"
          className="idocs-fold-btn"
          title="Fold everything"
          aria-label="Fold everything"
          onClick={() => setFolded(new Set(foldable))}
          disabled={foldable.length === 0}
        >
          <FoldAll />
        </button>
        <button
          type="button"
          className="idocs-fold-btn"
          title="Unfold everything"
          aria-label="Unfold everything"
          onClick={() => setFolded(new Set())}
          disabled={folded.size === 0}
        >
          <UnfoldAll />
        </button>
      </div>
      <div className="idocs-ol-tree" role="tree" aria-label="Outline" onKeyDown={onKey}>
        {visible.map((row) => {
          const tabbable = row.key === tabStop
          if (row.type === 'group') {
            const open = !folded.has(row.key)
            return (
              <div
                key={row.key}
                role="treeitem"
                tabIndex={tabbable ? 0 : -1}
                data-row={row.key}
                aria-level={row.level + 1}
                aria-expanded={open}
                className="idocs-ol-row is-group"
                style={{ '--lvl': row.level } as React.CSSProperties}
                onFocus={() => setCursor(row.key)}
                onClick={() => toggle(row.key)}
              >
                <Chevron open={open} />
                {row.group.icon && <IconTile icon={row.group.icon} />}
                <span className="idocs-ol-title">{row.group.title}</span>
                {row.group.status !== 'built' && (
                  <span className={cx('idocs-pill', `st-${row.group.status}`)}>
                    {row.group.status}
                  </span>
                )}
                <span className="idocs-ol-n">{row.group.count}</span>
              </div>
            )
          }
          if (row.type === 'node') {
            const { node } = row
            const kids = hasChildren(row)
            const open = kids && !folded.has(row.key)
            const top = !node.path.includes('/')
            const inside = node.inside
            return (
              <div
                key={row.key}
                role="treeitem"
                tabIndex={tabbable ? 0 : -1}
                data-row={row.key}
                aria-level={row.level + 1}
                aria-selected={selected === node.path}
                aria-expanded={kids ? open : undefined}
                onFocus={() => setCursor(row.key)}
                className={cx(
                  'idocs-ol-row is-node',
                  selected === node.path && 'is-selected',
                  hovered === node.path && 'is-hovered',
                )}
                style={{ '--lvl': row.level } as React.CSSProperties}
                onClick={(e) => {
                  const act = (e.target as Element).closest('[data-act]')?.getAttribute('data-act')
                  if (act === 'chev') toggle(row.key)
                  else if (act === 'expand' && onExpand) onExpand(node.path)
                  else if (act === 'open' && onOpen) onOpen(node.path)
                  else onSelect(node.path)
                }}
                onMouseEnter={() => top && onHoverNode(node.path)}
                onMouseLeave={() => top && onHoverNode(null)}
              >
                <span className="idocs-ol-chev-hit" data-act="chev" aria-hidden="true">
                  {kids && <Chevron open={open} />}
                </span>
                {node.icon ? <IconTile icon={node.icon} /> : <span className="idocs-ol-dot" />}
                <span className="idocs-ol-text">
                  <span className="idocs-ol-title">{node.title}</span>
                  {node.sub && <span className="idocs-ol-sub">{node.sub}</span>}
                </span>
                {node.status !== 'built' && (
                  <span className={cx('idocs-pill', `st-${node.status}`)}>{node.status}</span>
                )}
                {inside?.expand && onExpand && (
                  <span
                    className="idocs-ol-act"
                    data-act="expand"
                    aria-hidden="true"
                    title={inside.expanded ? 'Fold it back' : `Show ${inside.title} here`}
                  >
                    {inside.expanded ? <CollapseIcon /> : <ExpandIcon />}
                  </span>
                )}
                {inside?.open && onOpen && (
                  <span
                    className="idocs-ol-act"
                    data-act="open"
                    aria-hidden="true"
                    title={`Open ${inside.title}`}
                  >
                    <LayersIcon />
                  </span>
                )}
              </div>
            )
          }
          const { edge } = row
          const kind = kinds[edge.kind]
          const top = !row.node.path.includes('/')
          return (
            <div
              key={row.key}
              role="treeitem"
              tabIndex={tabbable ? 0 : -1}
              data-row={row.key}
              aria-level={row.level + 1}
              aria-label={`${DIR[edge.dir]} ${edge.otherTitle}${edge.label ? `, ${edge.label}` : ''}`}
              className={cx('idocs-ol-row is-edge', edge.status === 'planned' && 'is-planned')}
              style={{ '--lvl': row.level } as React.CSSProperties}
              onFocus={() => setCursor(row.key)}
              onClick={() => activate(row)}
              onMouseEnter={() => top && onHoverEdge(edge.edge)}
              onMouseLeave={() => top && onHoverEdge(null)}
            >
              <span
                className="idocs-ol-arrow"
                style={{ color: kind ? colorVar(kind.color) : undefined }}
                aria-hidden="true"
              >
                {ARROW[edge.dir]}
              </span>
              <span className="idocs-ol-text">
                <span className="idocs-ol-title">{edge.otherTitle}</span>
                {edge.label && <span className="idocs-ol-sub">{edge.label}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const hasChildren = (row: Row) =>
  row.type === 'node' && (row.node.connections.length > 0 || !!row.node.inside?.items.length)
