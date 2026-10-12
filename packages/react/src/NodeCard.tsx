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

/** What a node that holds another diagram tells the reader before they open it. */
export interface NodeInside {
  title: string
  nodes: number
  scenarios: number
}

export const insideSummary = (inside: NodeInside) =>
  `${inside.title}: ${count(inside.nodes, 'node')}, ${count(inside.scenarios, 'scenario')}`

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

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
  /** Set when the node holds a diagram that can be opened one level deeper. */
  inside?: NodeInside
  onSelect?: (id: string) => void
  /** Called instead of `onSelect` when the reader uses the card's "Look inside" strip. */
  onOpen?: (id: string) => void
  onHover?: (id: string | null) => void
}

export const NodeCard = memo(function NodeCard({
  node,
  style,
  state = {},
  measure,
  inside,
  onSelect,
  onOpen,
  onHover,
}: Props) {
  const interactive = !measure
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
      data-node={interactive ? node.id : undefined}
      data-measure={measure ? node.id : undefined}
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
              // action from the drawer, so the card stays one button with nothing nested in it.
              if (inside && onOpen && (e.target as Element).closest('.idocs-node-inside')) {
                e.stopPropagation()
                onOpen(node.id)
              } else onSelect?.(node.id)
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect?.(node.id)
              }
            }
          : undefined
      }
      onMouseEnter={interactive ? () => onHover?.(node.id) : undefined}
      onMouseLeave={interactive ? () => onHover?.(null) : undefined}
      onFocus={interactive ? () => onHover?.(node.id) : undefined}
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
        <div
          className="idocs-node-inside"
          title={`Look inside: ${insideSummary(inside)}`}
          aria-hidden="true"
        >
          <LayersIcon />
          <span>Look inside</span>
          <span className="idocs-node-inside-go">›</span>
        </div>
      )}
    </div>
  )
})
