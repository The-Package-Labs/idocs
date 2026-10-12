import type {
  CompiledDiagram,
  CompiledScenario,
  CompiledView,
  Timeline,
} from '@the-package-labs/idocs-core'
import { type KeyboardEvent, useId } from 'react'
import { Player, PlayerRail } from './Player'
import { StepPanel } from './StepPanel'
import type { Player as PlayerState } from './usePlayer'
import { cx, htmlText } from './util'

export type SideTab = 'scenarios' | 'timeline' | 'views'

const LABELS: Record<SideTab, string> = {
  scenarios: 'Scenarios',
  timeline: 'Timeline',
  views: 'Views',
}

interface Props {
  diagram: CompiledDiagram
  view: CompiledView
  /** The scenarios that play on the current view. */
  scenarios: CompiledScenario[]
  scenario: CompiledScenario | null
  onScenario: (id: string | null) => void
  onView: (id: string) => void
  tab: SideTab
  tabs: SideTab[]
  onTab: (tab: SideTab) => void
  open: boolean
  onOpen: (open: boolean) => void
  player: PlayerState
  timeline: Timeline | null
  mode: 'flow' | 'sequence' | 'story'
  onMode: (m: 'flow' | 'sequence' | 'story') => void
  stepIndex: number
  subtitles: boolean
  onSubtitles: (on: boolean) => void
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

const chevron = (open: boolean) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {open ? <path d="M9.5 3.5 5 8l4.5 4.5" /> : <path d="M6.5 3.5 11 8l-4.5 4.5" />}
  </svg>
)

/**
 * Everything about what to look at and how, in one column beside the picture: the scenarios, the
 * timeline of the one that is playing, the views, and the player. It can be folded away to a thin
 * rail that keeps the player's three buttons.
 */
export function Sidebar({
  diagram,
  view,
  scenarios,
  scenario,
  onScenario,
  onView,
  tab,
  tabs,
  onTab,
  open,
  onOpen,
  player,
  timeline,
  mode,
  onMode,
  stepIndex,
  subtitles,
  onSubtitles,
}: Props) {
  const uid = useId().replace(/:/g, '')
  const total = scenario?.steps.length ?? 0

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const step = keys[e.key]
    if (step === undefined) return
    e.preventDefault()
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!
    onTab(next)
    document.getElementById(`${uid}-tab-${next}`)?.focus()
  }

  return (
    <aside
      className={cx('idocs-side', !open && 'is-folded')}
      aria-label="Scenarios, timeline and views"
    >
      <div className="idocs-side-in">
        {open ? (
          <>
            <div className="idocs-side-head">
              <div className="idocs-side-tabs" role="tablist" aria-label="Panel" onKeyDown={onKey}>
                {tabs.map((t) => (
                  <button
                    key={t}
                    id={`${uid}-tab-${t}`}
                    type="button"
                    role="tab"
                    className="idocs-side-tab"
                    aria-selected={t === tab}
                    aria-controls={`${uid}-panel`}
                    tabIndex={t === tab ? 0 : -1}
                    onClick={() => onTab(t)}
                  >
                    {LABELS[t]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="idocs-side-fold"
                aria-label="Hide the panel"
                title="Hide the panel"
                onClick={() => onOpen(false)}
              >
                {chevron(true)}
              </button>
            </div>

            <div
              className="idocs-side-body"
              role="tabpanel"
              id={`${uid}-panel`}
              aria-labelledby={`${uid}-tab-${tab}`}
            >
              {tab === 'scenarios' && (
                <div className="idocs-scn-list" role="group" aria-label="Scenarios">
                  <button
                    type="button"
                    className="idocs-scn"
                    aria-pressed={!scenario}
                    onClick={() => onScenario(null)}
                  >
                    <span className="idocs-scn-title">Overview</span>
                    <span className="idocs-scn-sum">The diagram on its own, to explore.</span>
                  </button>
                  {scenarios.map((s) => {
                    const phases = s.phases.map(
                      (_, i) => s.steps.filter((x) => x.phase === i).length || 1,
                    )
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className="idocs-scn"
                        aria-pressed={s.id === scenario?.id}
                        onClick={() => onScenario(s.id)}
                      >
                        <span className="idocs-scn-title">{s.title}</span>
                        <span className="idocs-scn-meta">
                          {count(s.steps.length, 'step')}
                          {s.phases.length > 1 ? ` · ${count(s.phases.length, 'phase')}` : ''}
                          {s.mode && s.mode !== 'flow' ? ` · ${s.mode}` : ''}
                        </span>
                        {s.summaryHtml && (
                          <span className="idocs-scn-sum">{htmlText(s.summaryHtml)}</span>
                        )}
                        <span className="idocs-scn-bar" aria-hidden="true">
                          {phases.map((n, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: phases have no ids of their own
                            <i key={i} style={{ flexGrow: n }} />
                          ))}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {tab === 'timeline' && scenario && (
                <>
                  {scenario.summaryHtml && (
                    <div className="idocs-side-summary">
                      <span className="idocs-side-summary-title">The story in one breath</span>
                      <div dangerouslySetInnerHTML={{ __html: scenario.summaryHtml }} />
                    </div>
                  )}
                  <StepPanel
                    diagram={diagram}
                    scenario={scenario}
                    current={stepIndex}
                    ended={player.ended}
                    onSeek={player.playStep}
                  />
                </>
              )}

              {tab === 'views' && (
                <div className="idocs-scn-list" role="group" aria-label="Views">
                  {diagram.views.map((v) => {
                    const n = diagram.scenarios.filter((s) => s.view === v.id).length
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className="idocs-scn"
                        aria-pressed={v.id === view.id}
                        onClick={() => onView(v.id)}
                      >
                        <span className="idocs-scn-title">{v.title}</span>
                        <span className="idocs-scn-meta">
                          {count(v.nodeIds.length, 'node')}
                          {n ? ` · ${count(n, 'scenario')}` : ''}
                        </span>
                        {v.summaryHtml && (
                          <span className="idocs-scn-sum">{htmlText(v.summaryHtml)}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {scenario && timeline && (
              <Player
                player={player}
                timeline={timeline}
                mode={mode}
                onMode={onMode}
                stepIndex={stepIndex}
                subtitles={subtitles}
                onSubtitles={onSubtitles}
              />
            )}
          </>
        ) : (
          <div className="idocs-rail">
            <button
              type="button"
              className="idocs-side-fold"
              aria-label="Show the panel"
              title="Show the panel"
              onClick={() => onOpen(true)}
            >
              {chevron(false)}
            </button>
            {scenario && timeline && (
              <PlayerRail player={player} stepIndex={stepIndex} total={total} />
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
