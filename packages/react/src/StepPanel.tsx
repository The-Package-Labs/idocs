import type { CompiledDiagram, CompiledScenario } from '@the-package-labs/idocs-core'
import { useEffect, useRef } from 'react'
import { cx, roman } from './util'

interface Props {
  diagram: CompiledDiagram
  scenario: CompiledScenario
  /** Index of the step in progress, -1 before the start. */
  current: number
  ended: boolean
  onSeek: (index: number) => void
}

export function StepPanel({ diagram, scenario, current, ended, onSeek }: Props) {
  const root = useRef<HTMLDivElement>(null)
  // The list sits beside the picture to be followed: keep the step in progress in view inside the
  // panel that scrolls it, and never scroll the page for it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step in progress is the trigger
  useEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('.idocs-step.is-active')
    const box = el?.closest<HTMLElement>('.idocs-side-body')
    if (!el || !box) return
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const margin = 10
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const to = (top: number) => box.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
    if (r.top < b.top + margin) to(box.scrollTop + r.top - b.top - margin)
    else if (r.bottom > b.bottom - margin) to(box.scrollTop + r.bottom - b.bottom + margin)
  }, [current])
  const title = (id?: string) => (id ? (diagram.nodes[id]?.title ?? id) : '')
  const showPhases = scenario.phases.some((p) => p.title)
  let lastPhase = -1
  return (
    <div ref={root} className="idocs-steps" role="list" aria-label="Steps">
      {scenario.steps.map((s, i) => {
        const header =
          showPhases && s.phase !== lastPhase ? (
            <div className="idocs-phase" key={`p${s.phase}`}>
              <span className="idocs-phase-num">{roman(s.phase)}</span>
              <span className="idocs-phase-title">{scenario.phases[s.phase]?.title}</span>
              {scenario.phases[s.phase]?.caption && (
                <span className="idocs-phase-caption">{scenario.phases[s.phase]?.caption}</span>
              )}
            </div>
          ) : null
        lastPhase = s.phase
        const via =
          s.type === 'flow' && s.hops.length > 1 ? s.hops.slice(0, -1).map((h) => title(h.to)) : []
        return (
          <div key={s.id} style={{ display: 'contents' }}>
            {header}
            <div
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
                {s.label && (
                  <span className={cx('idocs-step-label', `kind-${s.kind}`)}>{s.label}</span>
                )}
                {s.status !== 'built' && (
                  <span className={cx('idocs-pill', `st-${s.status}`)}>{s.status}</span>
                )}
              </div>
              {s.noteHtml && (
                <div className="idocs-step-note" dangerouslySetInnerHTML={{ __html: s.noteHtml }} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
