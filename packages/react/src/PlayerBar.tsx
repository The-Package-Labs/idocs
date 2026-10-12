import {
  buildScrubber,
  type CompiledDiagram,
  type CompiledScenario,
  hasPhases,
  type Timeline,
} from '@the-package-labs/idocs-core'
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Chevron } from './Folding'
import { ScenarioMenu } from './ScenarioMenu'
import { StepSlider } from './StepSlider'
import { StepsPopover } from './StepsPopover'
import { useDismiss } from './useDismiss'
import type { Player as PlayerState } from './usePlayer'
import { cx, fmtTime, roman } from './util'

type Mode = 'flow' | 'sequence' | 'story'

interface Props {
  diagram: CompiledDiagram
  /** The scenarios that play on the current view. */
  scenarios: CompiledScenario[]
  scenario: CompiledScenario | null
  onScenario: (id: string | null) => void
  player: PlayerState
  timeline: Timeline | null
  /** The scenario has started, so there is a step to say something about. */
  started: boolean
  stepIndex: number
  mode: Mode
  onMode: (mode: Mode) => void
  /** Whether the words (the step's title and description) are shown. */
  subtitles: boolean
  onSubtitles: (on: boolean) => void
  /** Phases (by index) of the scenario that are folded away, in every presentation of it. */
  collapsed: ReadonlySet<number>
  onTogglePhase: (phase: number) => void
  onFoldPhases: (fold: boolean) => void
}

const icon = (d: string) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
)

const PREV = 'M3 2.5h1.8v11H3zM13 2.5v11L6 8z'
const NEXT = 'M11.2 2.5H13v11h-1.8zM3 2.5l7 5.5-7 5.5z'
const PLAY = 'M4 2.5v11l9-5.5z'
const PAUSE = 'M4 2.5h2.8v11H4zM9.2 2.5H12v11H9.2z'

function labelOf(player: PlayerState) {
  return player.playing ? 'Pause' : player.ended ? 'Replay' : player.t > 0 ? 'Resume' : 'Play'
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * The bar under the picture: which scenario to watch, what its step is saying, and the controls to
 * play it, with a slider of one segment per step grouped by phase. What a scenario says is shown
 * here, next to the controls that move it, and the whole list of steps is one press away.
 */
export function PlayerBar({
  diagram,
  scenarios,
  scenario,
  onScenario,
  player,
  timeline,
  started,
  stepIndex,
  mode,
  onMode,
  subtitles,
  onSubtitles,
  collapsed,
  onTogglePhase,
  onFoldPhases,
}: Props) {
  const uid = useId().replace(/:/g, '')
  const root = useRef<HTMLDivElement>(null)
  const stepsButton = useRef<HTMLButtonElement>(null)
  const stepsPop = useRef<HTMLDivElement>(null)
  const note = useRef<HTMLDivElement>(null)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const [popMax, setPopMax] = useState<number>()
  const closeSteps = useCallback(() => setStepsOpen(false), [])
  useDismiss(stepsOpen, closeSteps, stepsPop, stepsButton)

  const scrubber = useMemo(() => (timeline ? buildScrubber(timeline) : null), [timeline])
  const total = scenario?.steps.length ?? 0
  const step = scenario && started && stepIndex >= 0 ? scenario.steps[stepIndex] : undefined
  const phase = scenario && step && hasPhases(scenario) ? scenario.phases[step.phase] : undefined

  // Popovers open upward over the picture, so they may be no taller than the picture is. The
  // picture is another element in each presentation, and a placeholder before the layout is
  // ready, so it is looked up again whenever the workspace around it changes size.
  // biome-ignore lint/correctness/useExhaustiveDependencies: another presentation is another picture
  useEffect(() => {
    const workspace = root.current?.parentElement?.querySelector<HTMLElement>('.idocs-workspace')
    if (!workspace) return
    const measure = () => {
      const frame = workspace.querySelector<HTMLElement>('.idocs-frame')
      if (frame) setPopMax(Math.max(160, frame.clientHeight - 24))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(workspace)
    return () => ro.disconnect()
  }, [mode])

  // A description that does not fit says so, and the rest is one press away in the list of steps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the words change with the step
  useLayoutEffect(() => {
    const el = note.current
    setClipped(!!el && el.scrollHeight > el.clientHeight + 1)
  }, [step?.id, started, subtitles, scenario?.id])

  useEffect(() => {
    if (!scenario) setStepsOpen(false)
  }, [scenario])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !stepsOpen) return
    e.preventDefault()
    e.stopPropagation()
    setStepsOpen(false)
    stepsButton.current?.focus()
  }

  const name = (id?: string) => (id ? (diagram.nodes[id]?.title ?? id) : '')
  const route =
    step?.type === 'self' ? name(step.at) : step ? `${name(step.from)} → ${name(step.to)}` : ''
  const title = step ? (step.title ?? step.label ?? step.id) : ''
  const words = subtitles && scenario && timeline
  const described = step?.noteHtml ?? (!step ? scenario?.summaryHtml : undefined)
  // Room for a description is kept for the whole scenario if any step has one, so the bar does not
  // change height as it plays; a scenario with nothing to say has no empty lines to show.
  const hasNotes = !!scenario && (!!scenario.summaryHtml || scenario.steps.some((s) => s.noteHtml))

  return (
    <div
      ref={root}
      className={cx('idocs-bar', step && `kind-${step.kind}`, !scenario && 'is-idle')}
      role="group"
      aria-label="Scenario player"
      style={popMax ? ({ '--idocs-pop-max': `${popMax}px` } as React.CSSProperties) : undefined}
      onKeyDown={onKey}
    >
      <div className="idocs-bar-head">
        <ScenarioMenu scenarios={scenarios} scenario={scenario} onPick={onScenario} />
        {!scenario && <span className="idocs-bar-hint">Pick a scenario to watch it play.</span>}
        {words && step && (
          <div className="idocs-bar-title">
            {phase?.title && (
              <span className="idocs-bar-chip">
                {roman(step.phase)} · {phase.title}
              </span>
            )}
            <b>{title}</b>
            <span className="idocs-bar-route">
              {route}
              {step.label && step.title && step.label !== step.title ? ` · ${step.label}` : ''}
            </span>
          </div>
        )}
        {words && !step && scenario && (
          <span className="idocs-bar-meta">
            {count(total, 'step')}
            {scenario.phases.length > 1 ? ` · ${count(scenario.phases.length, 'phase')}` : ''}
          </span>
        )}
        {scenario && timeline && (
          <span className="idocs-time">
            {step
              ? `step ${stepIndex + 1}/${total} · ${fmtTime(player.t)}`
              : words
                ? fmtTime(player.t)
                : `${count(total, 'step')} · ${fmtTime(player.t)}`}
          </span>
        )}
      </div>

      {words && hasNotes && (
        <div className="idocs-bar-words">
          <div
            ref={note}
            className="idocs-bar-note"
            dangerouslySetInnerHTML={{ __html: described ?? '' }}
          />
          {clipped && (
            <button
              type="button"
              className="idocs-bar-more"
              aria-expanded={stepsOpen}
              onClick={() => setStepsOpen(true)}
            >
              more
            </button>
          )}
        </div>
      )}

      {scenario && timeline && scrubber && (
        <div className="idocs-bar-controls">
          <div className="idocs-bar-transport">
            <button
              type="button"
              className="idocs-btn"
              onClick={player.prev}
              aria-label="Previous step"
              title="Previous step"
              disabled={!started}
            >
              {icon(PREV)}
            </button>
            <button type="button" className="idocs-btn is-primary" onClick={player.toggle}>
              {icon(player.playing ? PAUSE : PLAY)}
              {labelOf(player)}
            </button>
            <button
              type="button"
              className="idocs-btn"
              onClick={player.next}
              aria-label="Next step"
              title="Next step"
              disabled={stepIndex >= total - 1 && player.ended}
            >
              {icon(NEXT)}
            </button>
          </div>

          <StepSlider
            scrubber={scrubber}
            timeline={timeline}
            t={player.t}
            onScrub={player.scrub}
            onPrev={player.prev}
            onNext={player.next}
          />

          <div className="idocs-bar-settings">
            <button
              ref={stepsButton}
              type="button"
              className="idocs-btn idocs-steps-btn"
              aria-expanded={stepsOpen}
              aria-controls={stepsOpen ? `${uid}-steps` : undefined}
              title={stepsOpen ? 'Fold the steps away' : 'List every step'}
              onClick={() => setStepsOpen(!stepsOpen)}
            >
              Steps
              <Chevron open={stepsOpen} className="idocs-steps-chev" />
            </button>
            <select
              className="idocs-btn"
              value={player.speed}
              onChange={(e) => player.setSpeed(Number(e.target.value))}
              aria-label="Playback speed"
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
            <button
              type="button"
              className="idocs-btn idocs-cc"
              aria-pressed={subtitles}
              onClick={() => onSubtitles(!subtitles)}
              title={subtitles ? 'Hide the words' : 'Show the words'}
              aria-label="Subtitles"
            >
              CC
            </button>
            <div className="idocs-modes" role="group" aria-label="Presentation">
              <button type="button" aria-pressed={mode === 'flow'} onClick={() => onMode('flow')}>
                Flow
              </button>
              <button
                type="button"
                aria-pressed={mode === 'sequence'}
                onClick={() => onMode('sequence')}
              >
                Sequence
              </button>
              <button type="button" aria-pressed={mode === 'story'} onClick={() => onMode('story')}>
                Story
              </button>
            </div>
          </div>
        </div>
      )}

      {stepsOpen && scenario && (
        <div ref={stepsPop} className="idocs-steps-wrap">
          <StepsPopover
            id={`${uid}-steps`}
            diagram={diagram}
            scenario={scenario}
            current={stepIndex}
            ended={player.ended}
            onSeek={player.playStep}
            collapsed={collapsed}
            onTogglePhase={onTogglePhase}
            onFoldPhases={onFoldPhases}
          />
        </div>
      )}
    </div>
  )
}
