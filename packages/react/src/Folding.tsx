import { cx } from './util'

/** The small arrow of a row that folds: it points right, and down while the row is open. */
export function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      className={cx('idocs-chev', open && 'is-open', className)}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  )
}

const stroke = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

/** Two arrows closing in on each other: fold everything away. */
export const FoldAll = () => (
  <svg {...stroke}>
    <path d="M4 5.5 8 2.5l4 3M4 10.5l4 3 4-3" />
  </svg>
)

/** Two arrows moving apart: show everything. */
export const UnfoldAll = () => (
  <svg {...stroke}>
    <path d="M4 2.5l4 3 4-3M4 13.5l4-3 4 3" />
  </svg>
)
