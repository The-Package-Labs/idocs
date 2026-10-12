import { describe, expect, it } from 'vitest'
import { type CompiledDiagram, defaultMode, openingView, startOf } from '../src'
import { compileText } from './helpers'

const BASE = `
title: Shop
nodes: { a: A, b: B, c: C }
edges: [a -> b, b -> c]
views:
  overview: { title: Overview }
  backend: { include: [b, c] }
scenarios:
  browse:
    title: Browse
    view: overview
    steps: [a -> b]
  charge:
    title: Charge
    view: backend
    mode: story
    steps: [b -> c]
  audit:
    title: Audit
    view: backend
    steps: [b -> c]
`

function compile(defaults = ''): CompiledDiagram {
  const r = compileText(`${BASE}${defaults}`)
  expect(r.diagnostics).toEqual([])
  return r.diagram!
}

const problems = (defaults: string) =>
  compileText(`${BASE}${defaults}`).diagnostics.filter((d) => d.severity === 'error')

describe('defaults in the diagram', () => {
  it('are kept as written, and absent when nothing is set', () => {
    expect(compile().defaults).toBeUndefined()
    expect(compile('defaults: {}\n').defaults).toBeUndefined()
    expect(
      compile(
        'defaults: { view: backend, scenario: audit, mode: sequence, sidebar: false, subtitles: false, autoplay: true }\n',
      ).defaults,
    ).toEqual({
      view: 'backend',
      scenario: 'audit',
      mode: 'sequence',
      sidebar: false,
      subtitles: false,
      autoplay: true,
    })
  })

  it('name a view that exists, and say which one was meant', () => {
    const [d] = problems('defaults: { view: backed }\n')
    expect(d?.message).toBe('defaults.view "backed" is not a view')
    expect(d?.hint).toBe('Did you mean "backend"?')
    expect(d?.path).toBe('defaults.view')
    expect(d?.line).toBeGreaterThan(0)
  })

  it('name a scenario that exists', () => {
    const [d] = problems('defaults: { scenario: charg }\n')
    expect(d?.message).toBe('defaults.scenario "charg" is not a scenario')
    expect(d?.hint).toBe('Did you mean "charge"?')
  })

  it('do not name a scenario that plays on another view than the one they name', () => {
    const [d] = problems('defaults: { view: overview, scenario: charge }\n')
    expect(d?.message).toBe('defaults.scenario "charge" plays on view "backend", not "overview"')
    expect(problems('defaults: { view: backend, scenario: charge }\n')).toEqual([])
  })

  it('do not autoplay without a scenario', () => {
    expect(problems('defaults: { autoplay: true }\n')[0]?.path).toBe('defaults.autoplay')
  })

  it('reject a mode that is not one of the three, and a key that is not known', () => {
    expect(problems('defaults: { mode: swimlane }\n')[0]?.path).toBe('defaults.mode')
    const [d] = problems('defaults: { sidbar: false }\n')
    expect(d?.message).toContain('sidbar')
    expect(d?.hint).toBe('Did you mean "sidebar"?')
  })
})

describe('where a diagram opens', () => {
  it('is the first view with nothing selected, by default', () => {
    expect(startOf(compile())).toEqual({ view: 'overview', scenario: null, mode: 'flow' })
  })

  it('follows the diagram: its scenario brings its view, and its mode applies', () => {
    const d = compile('defaults: { scenario: audit, mode: sequence }\n')
    expect(startOf(d)).toEqual({ view: 'backend', scenario: 'audit', mode: 'sequence' })
    expect(defaultMode(d)).toBe('sequence')
  })

  it('opens on the default view when there is no default scenario', () => {
    const d = compile('defaults: { view: backend }\n')
    expect(startOf(d)).toEqual({ view: 'backend', scenario: null, mode: 'flow' })
  })

  it('lets a scenario say how it is drawn, before the diagram does', () => {
    const d = compile('defaults: { scenario: charge, mode: sequence }\n')
    expect(startOf(d).mode).toBe('story')
  })

  it('lets the page choose otherwise, and fills in only what the page left open', () => {
    const d = compile('defaults: { scenario: audit, mode: sequence }\n')
    // A scenario of the page's own takes its view along, and the diagram's mode still applies.
    expect(startOf(d, { scenario: 'browse' })).toEqual({
      view: 'overview',
      scenario: 'browse',
      mode: 'sequence',
    })
    // A view of the page's own leaves out a default scenario that does not play there...
    expect(startOf(d, { view: 'overview' })).toEqual({
      view: 'overview',
      scenario: null,
      mode: 'sequence',
    })
    // ...and keeps it when it does.
    expect(startOf(d, { view: 'backend' }).scenario).toBe('audit')
    expect(startOf(d, { mode: 'flow' }).mode).toBe('flow')
  })

  it('never opens on something that is not there', () => {
    const d = compile()
    expect(startOf(d, { view: 'missing', scenario: 'missing' })).toEqual({
      view: 'overview',
      scenario: null,
      mode: 'flow',
    })
  })

  it('shows a node’s diagram on the view it opens on, unless the node asks for another', () => {
    const d = compile('defaults: { scenario: audit }\n')
    expect(openingView(d, { name: 't' })).toBe('backend')
    expect(openingView(d, { name: 't', view: 'overview' })).toBe('overview')
    expect(openingView(d, { name: 't', scenario: 'browse' })).toBe('overview')
    expect(openingView(compile(), { name: 't' })).toBe('overview')
  })
})
