import {
  type CompiledDiagram,
  type CompiledScenario,
  hasPhases,
  phaseSpans,
} from '@the-package-labs/idocs-core'
import { useEffect, useMemo, useRef } from 'react'
import { Markup } from './Markup'
import { PhaseHead } from './PhaseHead'
import { cx, keepInView } from './util'

interface Props {
  diagram: CompiledDiagram
  scenario: CompiledScenario
  /** Index of the step in progress, -1 before the start. */
  current: number
  ended: boolean
  onSeek: (index: number) => void
  /** Phases (by index) the reader has folded away. */
  collapsed: ReadonlySet<number>
  onTogglePhase: (phase: number) => void
}

export function StepPanel({
  diagram,
  scenario,
  current,
  ended,
  onSeek,
  collapsed,
  onTogglePhase,
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  // The list sits beside the picture to be followed: keep the step in progress in view inside the
  // panel that scrolls it, and never scroll the page for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step in progress is the trigger
  useEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('.idocs-step.is-active')
    const box = el?.closest<HTMLElement>('.idocs-steps-pop-body, .idocs-panel-body')
    if (el && box) keepInView(el, box)
  }, [current])
  const title = (id?: string) => (id ? (diagram.nodes[id]?.title ?? id) : '')
  const spans = useMemo(() => phaseSpans(scenario), [scenario])
  const named = hasPhases(scenario)

  const step = (i: number) => {
    const s = scenario.steps[i]!
    const via =
      s.type === 'flow' && s.hops.length > 1 ? s.hops.slice(0, -1).map((h) => title(h.to)) : []
    return (
      <div
        key={s.id}
        className={cx(
          'idocs-step',
          i === current && 'is-active',
          (ended || i < current) && 'is-done',
        )}
        role="listitem"
        tabIndex={0}
        onClick={() => onSeek(i)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSeek(i)
          }
        }}
      >
        <span className="idocs-step-n">{s.n}</span>
        <div className="idocs-step-main">
          <span className="idocs-step-route">
            {s.type === 'self' ? (
              title(s.at)
            ) : (
              <>
                {title(s.from)}
                <span className="idocs-step-arrow">→</span>
                {title(s.to)}
              </>
            )}
          </span>
          {via.length > 0 && <span className="idocs-step-label">via {via.join(', ')}</span>}
          {s.label && <span className={cx('idocs-step-label', `kind-${s.kind}`)}>{s.label}</span>}
          {s.status !== 'built' && (
            <span className={cx('idocs-pill', `st-${s.status}`)}>{s.status}</span>
          )}
        </div>
        {s.noteHtml && <Markup className="idocs-step-note" html={s.noteHtml} />}
      </div>
    )
  }

  // Phases the author named are folders: a header, then the steps, unless the reader folded it.
  // A scenario written as plain steps is just the list.
  const run = (from: number, count: number) =>
    Array.from({ length: count }, (_, k) => step(from + k))
  return (
    <div ref={root} className="idocs-steps">
      {named ? (
        spans.map((span) => {
          const open = !collapsed.has(span.index)
          const here = current >= span.from && current <= span.to
          const played = ended
            ? span.count
            : current < span.from
              ? 0
              : Math.min(span.count, current - span.from + 1)
          return (
            <div key={span.index} className="idocs-phase-group">
              <PhaseHead
                span={span}
                open={open}
                active={here}
                done={played}
                summary={here ? scenario.steps[current]?.label : undefined}
                onToggle={() => onTogglePhase(span.index)}
              />
              {open && (
                <div role="list" aria-label={span.title}>
                  {run(span.from, span.count)}
                </div>
              )}
            </div>
          )
        })
      ) : (
        <div role="list" aria-label="Steps">
          {run(0, scenario.steps.length)}
        </div>
      )}
    </div>
  )
}
