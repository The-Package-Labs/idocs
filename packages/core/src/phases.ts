// A scenario's phases as runs of steps, so a list, a sequence or a story can fold one away.
import type { CompiledScenario } from './types'

export interface PhaseSpan {
  /** Index in `scenario.phases`. */
  index: number
  title: string
  caption?: string
  /** Index of its first and last step in `scenario.steps`. */
  from: number
  to: number
  /** How many steps it holds. */
  count: number
}

/** Whether the author named the phases. A scenario written as plain `steps` has one nameless phase. */
export const hasPhases = (scenario: CompiledScenario): boolean =>
  scenario.phases.some((p) => p.title)

/** The phases that hold steps, in order. Steps follow their phase, so each phase is one run. */
export function phaseSpans(scenario: CompiledScenario): PhaseSpan[] {
  const out: PhaseSpan[] = []
  scenario.steps.forEach((step, i) => {
    const last = out[out.length - 1]
    if (last && last.index === step.phase) {
      last.to = i
      last.count++
      return
    }
    const phase = scenario.phases[step.phase]
    out.push({
      index: step.phase,
      title: phase?.title ?? '',
      caption: phase?.caption,
      from: i,
      to: i,
      count: 1,
    })
  })
  return out
}
