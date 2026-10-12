// The slider under the picture, as a model. Every step gets a slot of the same width, however long
// its packet takes to fly, and slots are grouped into the scenario's phases, like the chapters of a
// video. The component only draws what this says.
import { phaseSpans } from './phases'
import type { Timeline } from './timeline'

/** One stop of the slider: a step, or the steps of a `par` block that start together. */
export interface Slot {
  /** First and last step of the slot, as indexes into `scenario.steps`. */
  from: number
  to: number
  /** The time it covers. A slot runs until the next one starts, so pauses belong to the step before. */
  t0: number
  t1: number
}

/** A run of slots under one phase. A scenario without named phases is one section with no title. */
export interface Section {
  /** Index in `scenario.phases`. */
  phase: number
  title: string
  caption?: string
  /** First and last slot. */
  from: number
  to: number
}

export interface Scrubber {
  slots: Slot[]
  sections: Section[]
  duration: number
}

export function buildScrubber(tl: Timeline): Scrubber {
  const steps = tl.scenario.steps
  const slots: Slot[] = []
  let i = 0
  while (i < steps.length) {
    let j = i + 1
    const par = steps[i]!.par
    if (par !== undefined) while (j < steps.length && steps[j]!.par === par) j++
    const run = tl.steps.slice(i, j)
    slots.push({ from: i, to: j - 1, t0: Math.min(...run.map((s) => s.start)), t1: 0 })
    i = j
  }
  slots.forEach((slot, k) => {
    slot.t1 = slots[k + 1]?.t0 ?? tl.duration
  })
  if (slots[0]) slots[0].t0 = 0

  const slotOf = (step: number) => slots.findIndex((s) => s.from <= step && step <= s.to)
  const sections = phaseSpans(tl.scenario).map((span) => ({
    phase: span.index,
    title: span.title,
    caption: span.caption,
    from: slotOf(span.from),
    to: slotOf(span.to),
  }))
  return { slots, sections, duration: tl.duration }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Where on the slider, 0 to 1, the moment `t` falls. */
export function positionAt(s: Scrubber, t: number): number {
  const n = s.slots.length
  if (!n) return 0
  let k = 0
  s.slots.forEach((slot, i) => {
    if (slot.t0 <= t) k = i
  })
  const slot = s.slots[k]!
  const length = slot.t1 - slot.t0
  return (k + (length > 0 ? clamp01((t - slot.t0) / length) : 0)) / n
}

/** The moment a place on the slider stands for. The inverse of `positionAt`. */
export function timeAt(s: Scrubber, position: number): number {
  const n = s.slots.length
  if (!n) return 0
  const x = clamp01(position) * n
  const k = Math.min(n - 1, Math.floor(x))
  const slot = s.slots[k]!
  return slot.t0 + (x - k) * (slot.t1 - slot.t0)
}

/** The slot a place on the slider falls in. */
export function slotAt(s: Scrubber, position: number): number {
  const n = s.slots.length
  return n ? Math.min(n - 1, Math.floor(clamp01(position) * n)) : -1
}

/** The slot that holds step `index`, or -1. */
export function slotOfStep(s: Scrubber, index: number): number {
  return s.slots.findIndex((slot) => slot.from <= index && index <= slot.to)
}
