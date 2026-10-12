import {
  positionAt,
  type Scrubber,
  slotAt,
  type Timeline,
  timeAt,
} from '@the-package-labs/idocs-core'
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react'
import { cx, roman } from './util'

interface Props {
  scrubber: Scrubber
  timeline: Timeline
  /** The moment the player is at, in seconds. */
  t: number
  onScrub: (t: number) => void
  onPrev: () => void
  onNext: () => void
}

/** Where the tip over the slider sits: on the pointer, but never hanging over either end. */
function tipAt(hover: { at: number; x: number }): React.CSSProperties {
  if (hover.at < 0.2) return { left: 0 }
  if (hover.at > 0.8) return { right: 0 }
  return { left: hover.x, transform: 'translateX(-50%)' }
}

/** Past this many stops the gaps between them would eat the slider: sections only. */
const MAX_CELLS = 48

/**
 * The scrubber of a scenario, drawn like the chapters of a video: a segment for each step, all of
 * the same width, grouped by phase. The fill says how far the scenario has played, and pointing at
 * a place says which step is there. The model is `Scrubber` in core; this only draws it.
 */
export function StepSlider({ scrubber, timeline, t, onScrub, onPrev, onNext }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [hover, setHover] = useState<{ at: number; x: number } | null>(null)
  const steps = timeline.scenario.steps
  const n = scrubber.slots.length
  const position = positionAt(scrubber, t)
  const here = slotAt(scrubber, Math.min(position, 0.999999))
  const cells = n <= MAX_CELLS

  const place = (e: PointerEvent) => {
    const r = track.current!.getBoundingClientRect()
    return { at: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), x: e.clientX - r.left }
  }
  const describe = (slot: number) => {
    const s = scrubber.slots[slot]
    const step = s && steps[s.from]
    if (!step) return ''
    const section = scrubber.sections.find((x) => x.from <= slot && slot <= x.to)
    const phase = section?.title ? `${roman(section.phase)} · ${section.title} — ` : ''
    return `${phase}${step.n}. ${step.title ?? step.label ?? step.id}`
  }

  const onKey = (e: KeyboardEvent) => {
    const act: Record<string, () => void> = {
      ArrowRight: onNext,
      ArrowUp: onNext,
      ArrowLeft: onPrev,
      ArrowDown: onPrev,
      Home: () => onScrub(0),
      End: () => onScrub(timeline.duration),
    }
    const run = act[e.key]
    if (!run) return
    e.preventDefault()
    run()
  }

  const slot = scrubber.slots[here]
  const step = slot && steps[slot.from]
  return (
    <div
      className="idocs-slider"
      role="slider"
      tabIndex={0}
      aria-label="Scenario position"
      aria-orientation="horizontal"
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={here + 1}
      aria-valuetext={
        step ? `Step ${step.n} of ${steps.length}: ${step.title ?? step.label}` : undefined
      }
      onKeyDown={onKey}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        onScrub(timeAt(scrubber, place(e).at))
      }}
      onPointerMove={(e) => {
        const p = place(e)
        setHover(p)
        if (dragging.current) onScrub(timeAt(scrubber, p.at))
      }}
      onPointerUp={(e) => {
        dragging.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div ref={track} className={cx('idocs-slider-track', !cells && 'is-solid')}>
        {scrubber.sections.map((section) => {
          const count = section.to - section.from + 1
          return (
            <div
              key={section.phase}
              className="idocs-slider-section"
              data-phase={section.phase}
              style={{ flex: `${count} 1 0` }}
            >
              {scrubber.slots.slice(section.from, section.to + 1).map((_, i) => {
                const k = section.from + i
                const fill = Math.min(1, Math.max(0, position * n - k))
                return (
                  <i
                    key={k}
                    className={cx('idocs-slider-cell', k === here && 'is-here')}
                    style={{ flex: '1 1 0' }}
                  >
                    <span>
                      <b style={{ width: `${fill * 100}%` }} />
                    </span>
                  </i>
                )
              })}
            </div>
          )
        })}
      </div>
      <div
        className="idocs-slider-knob"
        style={{ left: `${position * 100}%` }}
        aria-hidden="true"
      />
      {hover && (
        <div className="idocs-slider-tip" style={tipAt(hover)} aria-hidden="true">
          {describe(slotAt(scrubber, hover.at))}
        </div>
      )}
    </div>
  )
}
