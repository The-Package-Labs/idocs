import { describe, expect, it } from 'vitest'
import { attachNested, type LinkEntry, linkDiagrams, nestedDiagrams } from '../src'
import { compileDiagram } from '../src/node'
import { compileText, loadDocs } from './helpers'

/** Compile each text as a diagram folder of that name, then link them like `loadProject` does. */
function project(texts: Record<string, string>) {
  const entries: Record<string, LinkEntry> = {}
  const diagrams: Record<string, NonNullable<LinkEntry['diagram']>> = {}
  for (const [name, text] of Object.entries(texts)) {
    const r = compileDiagram({ name, file: `diagrams/${name}/diagram.yaml`, text })
    entries[name] = { diagram: r.diagram, where: r.where }
    if (r.diagram) diagrams[name] = r.diagram
  }
  return { diagrams, errors: linkDiagrams(entries) }
}

const leaf = `title: Leaf
nodes:
  a: A
  b: B
edges:
  - a -> b
views:
  main: {}
  deep: { title: Deep }
scenarios:
  run:
    title: Run
    view: deep
    steps: [a -> b]
`

describe('the diagram key on a node', () => {
  it('takes a plain name', () => {
    const r = compileText('title: T\nnodes:\n  svc: { diagram: payments }\n')
    expect(r.diagnostics).toEqual([])
    expect(r.diagram!.nodes.svc!.diagram).toEqual({ name: 'payments' })
  })

  it('takes a name with the view and scenario to open on', () => {
    const r = compileText(
      'title: T\nnodes:\n  svc:\n    diagram: { name: payments, view: refunds, scenario: pay }\n',
    )
    expect(r.diagnostics).toEqual([])
    expect(r.diagram!.nodes.svc!.diagram).toEqual({
      name: 'payments',
      view: 'refunds',
      scenario: 'pay',
    })
  })

  it('stays plain JSON, so it can cross to the client', () => {
    const r = compileText('title: T\nnodes:\n  svc: { diagram: x }\n')
    expect(JSON.parse(JSON.stringify(r.diagram!.nodes.svc))).toEqual(r.diagram!.nodes.svc)
  })

  it('leaves a result postable to a worker: the locator closure is not part of its data', () => {
    const r = compileText('title: T\nnodes:\n  svc: { diagram: x }\n')
    expect(typeof r.where).toBe('function')
    expect(Object.keys(r)).toEqual(['diagram', 'diagnostics'])
    expect(() => structuredClone({ revision: 1, ...r })).not.toThrow()
    expect(JSON.parse(JSON.stringify(r))).not.toHaveProperty('where')
  })

  it('suggests the key when it is misspelt', () => {
    const r = compileText('title: T\nnodes:\n  svc: { diagrams: x }\n')
    expect(r.diagnostics[0]!.hint).toContain('"diagram"')
  })

  it('rejects an empty name', () => {
    const r = compileText('title: T\nnodes:\n  svc: { diagram: "" }\n')
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })

  it('rejects keys it does not know inside the object form', () => {
    const r = compileText('title: T\nnodes:\n  svc:\n    diagram: { name: x, scene: y }\n')
    expect(r.diagnostics[0]!.message).toContain('"scene"')
  })
})

describe('linking diagrams', () => {
  it('accepts a node that opens an existing diagram, view and scenario', () => {
    const { errors } = project({
      shop: `title: Shop\nnodes:\n  pay: { diagram: { name: leaf, view: deep, scenario: run } }\n`,
      leaf,
    })
    expect(errors).toEqual([])
  })

  it('reports a diagram that does not exist, at the node, with a suggestion', () => {
    const { errors } = project({
      shop: `title: Shop\nnodes:\n  pay: { diagram: laef }\n`,
      leaf,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      severity: 'error',
      file: 'diagrams/shop/diagram.yaml',
      line: 3,
      path: 'nodes.pay.diagram',
    })
    expect(errors[0]!.message).toBe('Node "pay" opens diagram "laef", which does not exist')
    expect(errors[0]!.hint).toContain('"leaf"')
  })

  it('lists the other diagrams when nothing is close', () => {
    const { errors } = project({
      shop: `title: Shop\nnodes:\n  pay: { diagram: zzzzzzzz }\n`,
      leaf,
    })
    expect(errors[0]!.hint).toBe('Diagrams: leaf')
  })

  it('reports a view the diagram does not have, at the view key', () => {
    const { errors } = project({
      shop: `title: Shop\nnodes:\n  pay:\n    diagram:\n      name: leaf\n      view: dep\n`,
      leaf,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ line: 6, path: 'nodes.pay.diagram.view' })
    expect(errors[0]!.message).toBe('Diagram "leaf" has no view "dep"')
    expect(errors[0]!.hint).toContain('"deep"')
  })

  it('reports a scenario the diagram does not have', () => {
    const { errors } = project({
      shop: `title: Shop\nnodes:\n  pay: { diagram: { name: leaf, scenario: rn } }\n`,
      leaf,
    })
    expect(errors[0]!.message).toBe('Diagram "leaf" has no scenario "rn"')
    expect(errors[0]!.hint).toContain('"run"')
  })

  it('reports a scenario that plays on another view than the one asked for', () => {
    const { errors } = project({
      shop: `title: Shop\nnodes:\n  pay: { diagram: { name: leaf, view: main, scenario: run } }\n`,
      leaf,
    })
    expect(errors[0]!.message).toBe('Scenario "run" plays on view "deep", not "main"')
  })

  it('stays quiet about a diagram that failed to compile: its own errors say why', () => {
    const { errors } = project({
      shop: `title: Shop\nnodes:\n  pay: { diagram: broken }\n`,
      broken: 'title: Broken\nnodes:\n  a: [unclosed\n',
    })
    expect(errors).toEqual([])
  })

  it('refuses a node that opens its own diagram', () => {
    const { errors } = project({ loop: `title: L\nnodes:\n  me: { diagram: loop }\n` })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toBe('Node "me" opens its own diagram "loop"')
  })

  it('refuses diagrams that open each other, once, naming the circle', () => {
    const { errors } = project({
      a: `title: A\nnodes:\n  go: { diagram: b }\n`,
      b: `title: B\nnodes:\n  back: { diagram: c }\n`,
      c: `title: C\nnodes:\n  again: { diagram: a }\n`,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]!.hint).toBe('A diagram cannot be inside itself: a → b → c → a')
    expect(errors[0]!.file).toBe('diagrams/c/diagram.yaml')
  })

  it('allows two nodes to open the same diagram, and a diagram reached by two routes', () => {
    const { errors } = project({
      top: `title: T\nnodes:\n  x: { diagram: mid }\n  y: { diagram: leaf }\n`,
      mid: `title: M\nnodes:\n  z: { diagram: leaf }\n  w: { diagram: leaf }\n`,
      leaf,
    })
    expect(errors).toEqual([])
  })
})

describe('nestedDiagrams', () => {
  const { diagrams } = project({
    top: `title: T\nnodes:\n  x: { diagram: mid }\n  y: { diagram: gone }\n`,
    mid: `title: M\nnodes:\n  z: { diagram: leaf }\n`,
    leaf,
    other: 'title: O\nnodes:\n  q: Q\n',
  })

  it('collects everything reachable, however deep, and nothing else', () => {
    expect(Object.keys(nestedDiagrams(diagrams, 'top')).sort()).toEqual(['leaf', 'mid'])
    expect(Object.keys(nestedDiagrams(diagrams, 'mid'))).toEqual(['leaf'])
    expect(nestedDiagrams(diagrams, 'leaf')).toEqual({})
  })

  it('ignores names that are not diagrams', () => {
    expect(nestedDiagrams(diagrams, 'nope')).toEqual({})
  })

  it('terminates on a circle that linking would have refused', () => {
    const { diagrams: loop } = project({
      a: `title: A\nnodes:\n  go: { diagram: b }\n`,
      b: `title: B\nnodes:\n  back: { diagram: a }\n`,
    })
    expect(Object.keys(nestedDiagrams(loop, 'a'))).toEqual(['b'])
  })
})

describe('attachNested', () => {
  const { diagrams } = project({
    top: `title: T\nnodes:\n  x: { diagram: mid }\n  y: { diagram: leaf }\n`,
    mid: `title: M\nnodes:\n  z: { diagram: leaf }\n`,
    leaf,
    alone: 'title: O\nnodes:\n  q: Q\n',
  })
  const bundled = attachNested(diagrams)

  it('gives a diagram everything it can open, however deep', () => {
    expect(Object.keys(bundled.top!.nested!).sort()).toEqual(['leaf', 'mid'])
    expect(Object.keys(bundled.mid!.nested!)).toEqual(['leaf'])
  })

  it('leaves a diagram that opens nothing as it was, with no empty nested', () => {
    expect(bundled.leaf).toEqual(diagrams.leaf)
    expect(bundled.alone).toEqual(diagrams.alone)
    expect('nested' in bundled.alone!).toBe(false)
  })

  it('keeps the entries flat, so nothing is carried twice', () => {
    for (const d of Object.values(bundled.top!.nested!)) expect(d.nested).toBeUndefined()
  })

  it('is plain JSON, and does not touch what it was given', () => {
    expect(JSON.parse(JSON.stringify(bundled.top))).toEqual(bundled.top)
    expect(diagrams.top!.nested).toBeUndefined()
  })

  it('gives the same answer when applied twice', () => {
    expect(attachNested(bundled)).toEqual(bundled)
  })

  it('terminates on a circle that linking would have refused', () => {
    const { diagrams: loop } = project({
      a: `title: A\nnodes:\n  go: { diagram: b }\n`,
      b: `title: B\nnodes:\n  back: { diagram: a }\n`,
    })
    expect(Object.keys(attachNested(loop).a!.nested!)).toEqual(['b'])
  })
})

describe('the docs examples', () => {
  const docs = loadDocs()

  it('link without errors', () => {
    expect(docs.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('load with their insides attached: the nested shop reaches three levels', () => {
    expect(Object.keys(docs.diagrams['nest-shop']!.nested!).sort()).toEqual([
      'nest-orders',
      'nest-stock',
      'payments',
    ])
    expect(Object.keys(docs.diagrams['nest-orders']!.nested!)).toEqual(['nest-stock'])
  })

  it('leave a diagram that opens nothing without a nested key', () => {
    expect('nested' in docs.diagrams.checkout!).toBe(false)
  })
})
