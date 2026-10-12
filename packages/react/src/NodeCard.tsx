import type { CompiledNode } from '@the-package-labs/idocs-core'
import { memo } from 'react'
import { IconTile } from './Icon'
import { cx } from './util'

export interface NodeCardState {
  selected?: boolean
  hl?: boolean
  dim?: boolean
  visited?: boolean
  hidden?: boolean
  /** The node the reader has just come back from, pulsed once so the eye finds its place. */
  origin?: boolean
}

/** What a node that holds another diagram tells the reader before they use it. */
export interface NodeInside {
  title: string
  nodes: number
  scenarios: number
  /** The reader may show it in place, as a group. */
  expand: boolean
  /** The reader may move into it. */
  open: boolean
}

export const insideSummary = (inside: NodeInside) =>
  `${inside.title}: ${count(inside.nodes, 'node')}, ${count(inside.scenarios, 'scenario')}`

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

export function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9.5 2.5h4v4M13.5 2.5l-5 5M6.5 13.5h-4v-4M2.5 13.5l5-5" />
    </svg>
  )
}

export function CollapseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13.5 6.5H9.5v-4M9.5 6.5l4-4M2.5 9.5h4v4M6.5 9.5l-4 4" />
    </svg>
  )
}

export function LayersIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 2 2 5.2 8 8.4l6-3.2L8 2Z" />
      <path d="m2 8.2 6 3.2 6-3.2M2 11l6 3.2L14 11" />
    </svg>
  )
}

interface Props {
  node: CompiledNode
  style?: React.CSSProperties
  state?: NodeCardState
  measure?: boolean
  /**
   * Where the card is in a diagram shown inside another one: node ids joined with `/`. It names
   * the card to callbacks, and in `data-node`. A card at the top is just its id.
   */
  path?: string
  /** Set when the node holds a diagram the reader can expand in place or move into. */
  inside?: NodeInside
  onSelect?: (path: string) => void
  /** Called instead of `onSelect` when the reader uses the strip's "Expand". */
  onExpand?: (path: string) => void
  /** Called instead of `onSelect` when the reader uses the strip's "Open". */
  onOpen?: (path: string) => void
  onHover?: (path: string | null) => void
}

export const NodeCard = memo(function NodeCard({
  node,
  style,
  state = {},
  measure,
  path,
  inside,
  onSelect,
  onExpand,
  onOpen,
  onHover,
}: Props) {
  const interactive = !measure
  const id = path ?? node.id
  return (
    <div
      className={cx(
        'idocs-node',
        node.family && `fam-${node.family}`,
        `st-${node.status}`,
        state.selected && 'is-selected',
        state.hl && 'is-hl',
        state.dim && 'is-dim',
        state.visited && 'is-visited',
        state.hidden && 'is-hidden',
        state.origin && 'is-origin',
        inside && 'has-inside',
      )}
      style={style}
      data-node={interactive ? id : undefined}
      data-measure={measure ? id : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={
        interactive
          ? `${node.title}${node.sub ? `, ${node.sub}` : ''}. Open details${inside ? `. Holds a diagram: ${inside.title}` : ''}`
          : undefined
      }
      aria-hidden={measure ? true : undefined}
      onClick={
        interactive
          ? (e) => {
              // The strip is a shortcut for pointers. Keyboard and screen readers reach the same
              // actions from the drawer, so the card stays one button with nothing nested in it.
              const act =
                inside && (e.target as Element).closest('[data-act]')?.getAttribute('data-act')
              if (act === 'expand' && onExpand) {
                e.stopPropagation()
                onExpand(id)
              } else if (act === 'open' && onOpen) {
                e.stopPropagation()
                onOpen(id)
              } else onSelect?.(id)
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect?.(id)
              }
            }
          : undefined
      }
      onMouseEnter={interactive ? () => onHover?.(id) : undefined}
      onMouseLeave={interactive ? () => onHover?.(null) : undefined}
      onFocus={interactive ? () => onHover?.(id) : undefined}
      onBlur={interactive ? () => onHover?.(null) : undefined}
    >
      {node.badge && <span className="idocs-badge">{node.badge}</span>}
      <div className="idocs-node-head">
        {node.icon && <IconTile icon={node.icon} />}
        <div className="idocs-node-titles">
          <div className="idocs-node-title">{node.title}</div>
          {node.sub && <div className="idocs-node-sub">{node.sub}</div>}
        </div>
        {node.status !== 'built' && (
          <span className={cx('idocs-pill', `st-${node.status}`)}>{node.status}</span>
        )}
      </div>
      {node.lines.length > 0 && (
        <div className="idocs-node-lines">
          {node.lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      )}
      {node.chips.length > 0 && (
        <div className="idocs-chips">
          {node.chips.map((c) => (
            <div className="idocs-chip" key={c.label}>
              <b>{c.label}</b>
              {c.sub && <span>{c.sub}</span>}
            </div>
          ))}
        </div>
      )}
      {node.uses.length > 0 && <div className="idocs-node-uses">uses: {node.uses.join(' · ')}</div>}
      {inside && (
        <div className="idocs-node-inside" title={`${insideSummary(inside)}`} aria-hidden="true">
          {inside.expand && (
            <span className="idocs-node-act" data-act="expand" title="Show it here, as a group">
              <ExpandIcon />
              <span>Expand</span>
            </span>
          )}
          {inside.open && (
            <span className="idocs-node-act" data-act="open" title="Move into it, with a way back">
              <LayersIcon />
              <span>{inside.expand ? 'Open' : 'Look inside'}</span>
              <span className="idocs-node-inside-go">›</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
})
