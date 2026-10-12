import type { CompiledScenario } from '@the-package-labs/idocs-core'
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Chevron } from './Folding'
import { useDismiss } from './useDismiss'
import { cx, htmlText } from './util'

interface Props {
  scenarios: CompiledScenario[]
  /** The scenario in play, or null for the overview. */
  scenario: CompiledScenario | null
  onPick: (id: string | null) => void
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * Which scenario to watch: a button that names the one in play and opens a list of the others
 * upward, over the picture. The overview, the diagram on its own, is the first entry.
 */
export function ScenarioMenu({ scenarios, scenario, onPick }: Props) {
  const uid = useId().replace(/:/g, '')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, root)

  // Opening lands on the entry that is chosen, so the arrows start from where the reader is.
  useEffect(() => {
    if (!open) return
    const items = root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    const chosen = [...(items ?? [])].find((el) => el.getAttribute('aria-checked') === 'true')
    ;(chosen ?? items?.[0])?.focus({ preventScroll: true })
  }, [open])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
      return
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key]
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const to =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : step
            ? (at + step + items.length) % items.length
            : -1
    if (to < 0) return
    e.preventDefault()
    items[to]?.focus()
  }

  const choose = (id: string | null) => {
    setOpen(false)
    button.current?.focus({ preventScroll: true })
    onPick(id)
  }

  return (
    <div ref={root} className="idocs-sel" onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        className="idocs-sel-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${uid}-menu` : undefined}
        title="Choose a scenario"
        onClick={() => setOpen(!open)}
      >
        <span className="idocs-sel-label">{scenario ? scenario.title : 'Choose a scenario'}</span>
        <Chevron open={open} className="idocs-sel-chev" />
      </button>
      {open && (
        <div
          id={`${uid}-menu`}
          className="idocs-pop idocs-sel-pop"
          role="menu"
          aria-label="Scenarios"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!scenario}
            className={cx('idocs-sel-item', !scenario && 'is-chosen')}
            tabIndex={-1}
            onClick={() => choose(null)}
          >
            <span className="idocs-sel-title">Overview</span>
            <span className="idocs-sel-sum">The diagram on its own, to explore.</span>
          </button>
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.id === scenario?.id}
              className={cx('idocs-sel-item', s.id === scenario?.id && 'is-chosen')}
              tabIndex={-1}
              onClick={() => choose(s.id)}
            >
              <span className="idocs-sel-title">{s.title}</span>
              <span className="idocs-sel-meta">
                {count(s.steps.length, 'step')}
                {s.phases.length > 1 ? ` · ${count(s.phases.length, 'phase')}` : ''}
                {s.mode && s.mode !== 'flow' ? ` · ${s.mode}` : ''}
              </span>
              {s.summaryHtml && <span className="idocs-sel-sum">{htmlText(s.summaryHtml)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
