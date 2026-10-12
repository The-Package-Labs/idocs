import type { IconData } from '@the-package-labs/idocs-core'
import { forwardRef } from 'react'
import { IconTile } from './Icon'

export interface Crumb {
  /** Unique within the trail: a diagram appears once, because diagrams cannot nest in a circle. */
  key: string
  label: string
  /** Shown on hover: the diagram this level shows. */
  title?: string
  icon?: IconData
}

interface Props {
  crumbs: Crumb[]
  /** Go to the level at this index; 0 is the diagram the page showed first. */
  onJump: (index: number) => void
  onBack: () => void
}

/**
 * Where the reader is when a node has been opened: the way back, one step or all the way, and the
 * path that led here. Shown only below the first level.
 */
export const Trail = forwardRef<HTMLButtonElement, Props>(function Trail(
  { crumbs, onJump, onBack },
  backRef,
) {
  const parent = crumbs[crumbs.length - 2]
  return (
    <nav className="idocs-trail" aria-label="Diagram levels">
      <button
        ref={backRef}
        type="button"
        className="idocs-trail-back"
        onClick={onBack}
        aria-label={`Back to ${parent?.label ?? 'the previous level'}`}
        title="Back (Esc)"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M9.5 3.5 5 8l4.5 4.5" />
        </svg>
        <span>Back</span>
      </button>
      <ol className="idocs-trail-list">
        {crumbs.map((c, i) => {
          const here = i === crumbs.length - 1
          return (
            <li key={c.key} className={here ? 'is-here' : undefined}>
              {here ? (
                <span className="idocs-crumb" aria-current="location" title={c.title}>
                  {c.icon && <IconTile icon={c.icon} />}
                  <span className="idocs-crumb-label">{c.label}</span>
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="idocs-crumb is-link"
                    title={c.title}
                    onClick={() => onJump(i)}
                  >
                    {c.icon && <IconTile icon={c.icon} />}
                    <span className="idocs-crumb-label">{c.label}</span>
                  </button>
                  <span className="idocs-trail-sep" aria-hidden="true">
                    ›
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
})
