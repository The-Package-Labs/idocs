import type { CompiledDiagram, ScenarioMode } from './types'

/** What the page that shows a diagram asked for, if anything. Its choices win over the diagram's. */
export interface StartWant {
  view?: string
  scenario?: string
  mode?: ScenarioMode
}

export interface Start {
  /** Always one of the diagram's views. */
  view: string
  /** The scenario selected first, or null for the overview. */
  scenario: string | null
  mode: ScenarioMode
}

/** The mode a scenario is drawn in when neither it nor the page says: the diagram's, then `flow`. */
export const defaultMode = (diagram: CompiledDiagram): ScenarioMode =>
  diagram.defaults?.mode ?? 'flow'

/**
 * Where a diagram opens. The page's props come first, then what the diagram's author wrote under
 * `defaults`, then the first view with nothing selected. The page choosing a scenario takes its
 * view along, and one choosing a view leaves the default scenario out unless it plays there.
 */
export function startOf(diagram: CompiledDiagram, want: StartWant = {}): Start {
  const d = diagram.defaults ?? {}
  const scenarioById = (id?: string) => diagram.scenarios.find((s) => s.id === id)
  const hasView = (id?: string): id is string => diagram.views.some((v) => v.id === id)
  const first = diagram.views[0]!.id

  let view: string
  let scenario: string | null
  if (want.view !== undefined || want.scenario !== undefined) {
    view = [want.view, scenarioById(want.scenario)?.view].find(hasView) ?? first
    scenario =
      scenarioById(want.scenario)?.id ??
      (scenarioById(d.scenario)?.view === view ? (d.scenario ?? null) : null)
  } else {
    scenario = scenarioById(d.scenario)?.id ?? null
    view = [scenarioById(scenario ?? undefined)?.view, d.view].find(hasView) ?? first
  }
  const mode = want.mode ?? scenarioById(scenario ?? undefined)?.mode ?? defaultMode(diagram)
  return { view, scenario, mode }
}
