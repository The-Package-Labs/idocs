import { describe, expect, it } from 'vitest'
import {
  buildScrubber,
  buildTimeline,
  frameAt,
  positionAt,
  slotAt,
  slotOfStep,
  timeAt,
} from '../src'
import { loadDocs } from './helpers'

const docs = loadDocs().diagrams
const lengthsOf = (id: string) =>
  Object.fromEntries(Object.keys(docs[id]!.edges).map((e) => [e, 300]))
const scrubberOf = (diagram: string, scenario: string) => {
  const s = docs[diagram]!.scenarios.find((x) => x.id === scenario)!
  const tl = buildTimeline(s, lengthsOf(diagram))
  return { tl, scenario: s, scrub: buildScrubber(tl) }
}

describe('the slider of a scenario', () => {
  const { scenario, scrub } = scrubberOf('checkout', 'place-order')

  it('gives every step a slot, a par block sharing one, and tiles the whole timeline with them', () => {
    const runs = scenario.steps.filter(
      (s, i) => s.par === undefined || s.par !== scenario.steps[i - 1]?.par,
    )
    expect(scrub.slots).toHaveLength(runs.length)
    expect(runs.length).toBeLessThan(scenario.steps.length)
    expect(scrub.slots[0]!.t0).toBe(0)
    expect(scrub.slots.at(-1)!.t1).toBe(scrub.duration)
    scrub.slots.forEach((slot, k) => {
      expect(slot.t1).toBeGreaterThan(slot.t0)
      if (k) expect(slot.t0).toBe(scrub.slots[k - 1]!.t1)
    })
  })

  it('groups the slots into the phases the author wrote, in order, with none left over', () => {
    expect(scrub.sections.map((s) => s.title)).toEqual(scenario.phases.map((p) => p.title))
    expect(scrub.sections[0]!.from).toBe(0)
    expect(scrub.sections.at(-1)!.to).toBe(scrub.slots.length - 1)
    scrub.sections.forEach((section, k) => {
      expect(section.to).toBeGreaterThanOrEqual(section.from)
      if (k) expect(section.from).toBe(scrub.sections[k - 1]!.to + 1)
    })
  })

  it('maps a moment to a place and back', () => {
    for (const t of [0, 0.3, 1.1, scrub.duration / 2, scrub.duration - 0.2, scrub.duration]) {
      expect(timeAt(scrub, positionAt(scrub, t))).toBeCloseTo(t, 6)
    }
    expect(positionAt(scrub, 0)).toBe(0)
    expect(positionAt(scrub, scrub.duration)).toBe(1)
    expect(positionAt(scrub, scrub.duration + 5)).toBe(1)
    expect(positionAt(scrub, -3)).toBe(0)
  })

  it('moves forward only: a later moment is never a place further back', () => {
    let last = -1
    for (let i = 0; i <= 200; i++) {
      const p = positionAt(scrub, (scrub.duration * i) / 200)
      expect(p).toBeGreaterThanOrEqual(last)
      last = p
    }
  })

  it('gives each step a slot of the same width, however long its packet flies', () => {
    const n = scrub.slots.length
    scrub.slots.forEach((slot, k) => {
      expect(positionAt(scrub, slot.t0)).toBeCloseTo(k / n, 6)
    })
    // Their durations are not equal, which is the point of not drawing seconds.
    const lengths = new Set(scrub.slots.map((s) => (s.t1 - s.t0).toFixed(2)))
    expect(lengths.size).toBeGreaterThan(1)
  })

  it('lands on the step whose slot was chosen', () => {
    const tl = scrubberOf('checkout', 'place-order').tl
    scrub.slots.forEach((slot, k) => {
      const place = (k + 0.5) / scrub.slots.length
      expect(slotAt(scrub, place)).toBe(k)
      expect(frameAt(tl, timeAt(scrub, k / scrub.slots.length)).stepIndex).toBe(slot.to)
    })
  })

  it('finds the slot of a step', () => {
    expect(slotOfStep(scrub, 0)).toBe(0)
    expect(slotOfStep(scrub, scenario.steps.length - 1)).toBe(scrub.slots.length - 1)
    expect(slotOfStep(scrub, 99)).toBe(-1)
  })
})

describe('the slider of a scenario with parallel steps', () => {
  const { scenario, scrub } = scrubberOf('ref-steps', 'parallel')

  it('gives the steps of a par block one slot, since they start together', () => {
    const par = scenario.steps.filter((s) => s.par !== undefined)
    expect(par.length).toBeGreaterThan(1)
    expect(scrub.slots.length).toBe(scenario.steps.length - par.length + 1)
    const block = scrub.slots.find((slot) => slot.to > slot.from)!
    expect(block.to - block.from + 1).toBe(par.length)
    expect(slotOfStep(scrub, block.from)).toBe(slotOfStep(scrub, block.to))
  })
})

describe('the slider of a scenario written as plain steps', () => {
  const { scenario, scrub } = scrubberOf('ref-steps', 'kinds')

  it('is one section with no title that holds every slot', () => {
    expect(scrub.sections).toHaveLength(1)
    expect(scrub.sections[0]!.title).toBe('')
    expect(scrub.sections[0]).toMatchObject({ from: 0, to: scenario.steps.length - 1 })
  })
})
