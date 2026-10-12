import {
  type CompiledDiagram,
  type CompiledScenario,
  hasPhases,
} from '@the-package-labs/idocs-core'
import { FoldAll, UnfoldAll } from './Folding'
import { StepPanel } from './StepPanel'

interface Props {
  id: string
  diagram: CompiledDiagram
  scenario: CompiledScenario
  current: number
  ended: boolean
  onSeek: (index: number) => void
  collapsed: ReadonlySet<number>
  onTogglePhase: (phase: number) => void
  onFoldPhases: (fold: boolean) => void
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * Every step of the scenario as a list, with the story in a few words above it: what a slider
 * cannot hold. It opens upward from the bar, follows the step in progress, and plays a step when
 * it is clicked. Phases fold away here, in the sequence and in the story alike.
 */
export function StepsPopover({
  id,
  diagram,
  scenario,
  current,
  ended,
  onSeek,
  collapsed,
  onTogglePhase,
  onFoldPhases,
}: Props) {
  return (
    <div id={id} className="idocs-pop idocs-steps-pop" role="region" aria-label="Steps">
      <div className="idocs-steps-pop-body">
        {scenario.summaryHtml && (
          <div className="idocs-panel-summary">
            <span className="idocs-panel-summary-title">The story in one breath</span>
            <div dangerouslySetInnerHTML={{ __html: scenario.summaryHtml }} />
          </div>
        )}
        {hasPhases(scenario) && scenario.phases.length > 1 && (
          <div className="idocs-steps-bar">
            <span>{count(scenario.phases.length, 'phase')}</span>
            <button
              type="button"
              className="idocs-fold-btn"
              title="Fold every phase away"
              aria-label="Fold every phase away"
              onClick={() => onFoldPhases(true)}
              disabled={collapsed.size >= scenario.phases.length}
            >
              <FoldAll />
            </button>
            <button
              type="button"
              className="idocs-fold-btn"
              title="Show every phase"
              aria-label="Show every phase"
              onClick={() => onFoldPhases(false)}
              disabled={collapsed.size === 0}
            >
              <UnfoldAll />
            </button>
          </div>
        )}
        <StepPanel
          diagram={diagram}
          scenario={scenario}
          current={current}
          ended={ended}
          onSeek={onSeek}
          collapsed={collapsed}
          onTogglePhase={onTogglePhase}
        />
      </div>
    </div>
  )
}
