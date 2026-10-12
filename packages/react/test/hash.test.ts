import { describe, expect, it } from 'vitest'
import { OVERVIEW_MARK, scenarioHash } from '../src/hash'

describe('what the link says about the scenario', () => {
  it('is nothing for a diagram that opens on its overview, until a scenario is chosen', () => {
    expect(scenarioHash(null, -1, null)).toBeNull()
    expect(scenarioHash('pay', -1, null)).toBe('pay')
    expect(scenarioHash('pay', 2, null)).toBe('pay.3')
  })

  it('is nothing while the reader is where the diagram opens by itself', () => {
    expect(scenarioHash('pay', -1, 'pay')).toBeNull()
  })

  it('records a step of the scenario the diagram opens on, and any other scenario', () => {
    expect(scenarioHash('pay', 0, 'pay')).toBe('pay.1')
    expect(scenarioHash('refund', -1, 'pay')).toBe('refund')
  })

  it('marks the overview of a diagram that opens on a scenario, which has no id of its own', () => {
    expect(scenarioHash(null, -1, 'pay')).toBe(OVERVIEW_MARK)
    expect(/^[\w.-]+$/.test(OVERVIEW_MARK)).toBe(false)
  })
})
