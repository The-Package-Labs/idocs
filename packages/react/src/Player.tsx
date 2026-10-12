import type { Timeline } from '@the-package-labs/idocs-core'
import type { Player as PlayerState } from './usePlayer'
import { fmtTime } from './util'

interface Props {
  player: PlayerState
  timeline: Timeline
  mode: 'flow' | 'sequence' | 'story'
  onMode: (m: 'flow' | 'sequence' | 'story') => void
  stepIndex: number
  /** Whether the words under the picture are on. */
  subtitles: boolean
  onSubtitles: (on: boolean) => void
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

/** The player, laid out for the narrow column of the side panel. */
export function Player({
  player,
  timeline,
  mode,
  onMode,
  stepIndex,
  subtitles,
  onSubtitles,
}: Props) {
  const total = timeline.scenario.steps.length
  return (
    <div className="idocs-player" role="group" aria-label="Scenario player">
      <div className="idocs-player-row">
        <button
          type="button"
          className="idocs-btn"
          onClick={player.prev}
          aria-label="Previous step"
          title="Previous step"
          disabled={stepIndex < 0}
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
        <span className="idocs-time">
          {stepIndex >= 0 ? `step ${stepIndex + 1}/${total}` : `${total} steps`} ·{' '}
          {fmtTime(player.t)}
        </span>
      </div>
      <input
        className="idocs-scrub"
        type="range"
        min={0}
        max={timeline.duration}
        step={0.01}
        value={player.t}
        onChange={(e) => player.scrub(Number(e.target.value))}
        aria-label="Scenario position"
      />
      <div className="idocs-player-row">
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
          title={subtitles ? 'Turn the subtitles off' : 'Turn the subtitles on'}
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
  )
}

/** What stays of the player when the side panel is folded away: step back, play, step on. */
export function PlayerRail({
  player,
  stepIndex,
  total,
}: {
  player: PlayerState
  stepIndex: number
  total: number
}) {
  return (
    <div className="idocs-rail-player" role="group" aria-label="Scenario player">
      <button
        type="button"
        className="idocs-btn"
        onClick={player.prev}
        aria-label="Previous step"
        title="Previous step"
        disabled={stepIndex < 0}
      >
        {icon(PREV)}
      </button>
      <button
        type="button"
        className="idocs-btn is-primary"
        onClick={player.toggle}
        aria-label={labelOf(player)}
        title={labelOf(player)}
      >
        {icon(player.playing ? PAUSE : PLAY)}
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
  )
}
