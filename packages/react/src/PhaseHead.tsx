import type { PhaseSpan } from '@the-package-labs/idocs-core'
import { Chevron } from './Folding'
import { cx, roman } from './util'

interface Props {
  span: PhaseSpan
  /** The phase shows its steps. */
  open: boolean
  /** The step in progress belongs to it. */
  active: boolean
  /** How many of its steps have played (counting the one in progress). */
  done: number
  /** What is happening in it, shown while it is folded and in progress. */
  summary?: string
  onToggle: () => void
}

/**
 * The header of a phase in the list of steps: a button that folds the phase away. Folded, it still
 * says how far the phase has got, and what the step in progress is.
 */
export function PhaseHead({ span, open, active, done, summary, onToggle }: Props) {
  return (
    <button
      type="button"
      className={cx('idocs-phase', 'is-fold', open && 'is-open', active && 'is-active')}
      aria-expanded={open}
      title={open ? 'Fold this phase away' : 'Show this phase'}
      onClick={onToggle}
    >
      <Chevron open={open} />
      <span className="idocs-phase-num">{roman(span.index)}</span>
      <span className="idocs-phase-text">
        <span className="idocs-phase-title">{span.title}</span>
        {span.caption && open && <span className="idocs-phase-caption">{span.caption}</span>}
        {summary && !open && <span className="idocs-phase-caption">now: {summary}</span>}
      </span>
      <span className="idocs-phase-count">
        {done > 0 && !open ? `${done}/${span.count}` : span.count}
      </span>
    </button>
  )
}
