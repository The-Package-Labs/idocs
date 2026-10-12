import { describe, expect, it } from 'vitest'
import { buildOutline, type OutlineItem, outlineNodes, phaseSpans } from '../src'
import { compileText, loadDocs } from './helpers'

const docs = loadDocs().diagrams

const small = () => {
  const r = compileText(`title: T
groups:
  edge: { label: Edge }
  backend: { label: Backend }
  data: { label: Data, in: backend }
nodes:
  user: User
  gw: { title: Gateway, in: edge }
  api: { title: API, in: backend, sub: orders }
  db: { title: DB, in: data }
  log: { title: Log, in: backend }
edges:
  - user -> gw: HTTPS
  - gw -> api: route
  - api -> db: { label: SELECT, kind: data }
  - api -> log: { hidden: true }
  - db <-> api: sync
scenarios:
  s:
    title: S
    phases:
      - title: One
        steps:
          - user -> gw: go
          - gw -> api: on
      - title: Two
        steps:
          - api -> db: read
          - at api: shape
          - db -> api: rows
`)
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  return r.diagram!
}

const titles = (items: OutlineItem[]) => items.map((i) => i.title)

describe('buildOutline', () => {
  const d = small()
  const items = buildOutline(d, d.views[0]!)

  it('puts nested groups and nodes under the group that holds them', () => {
    // In the order the author wrote them: a group stands where its first node does.
    expect(items.map((i) => [i.type, i.title])).toEqual([
      ['node', 'User'],
      ['group', 'Edge'],
      ['group', 'Backend'],
    ])
    const backend = items[2]!
    if (backend.type !== 'group') throw new Error('not a group')
    expect(titles(backend.items)).toEqual(['API', 'Data', 'Log'])
    expect(backend.count).toBe(3)
  })

  it('lists a node’s connections, what it sends first, and leaves hidden edges out', () => {
    const api = outlineNodes(items).find((n) => n.id === 'api')!
    expect(api.connections.map((c) => [c.dir, c.otherTitle, c.label])).toEqual([
      ['out', 'DB', 'SELECT'],
      ['both', 'DB', 'sync'],
      ['in', 'Gateway', 'route'],
    ])
    expect(outlineNodes(items).find((n) => n.id === 'log')!.connections).toEqual([])
  })

  it('gives every node a path and every group one that cannot be mistaken for a node', () => {
    const paths = new Set<string>()
    const walk = (list: OutlineItem[]) => {
      for (const i of list) {
        paths.add(i.path)
        if (i.type === 'group') walk(i.items)
      }
    }
    walk(items)
    expect(paths.size).toBe(outlineNodes(items).length + 3)
    expect(outlineNodes(items).map((n) => n.path)).toEqual(['user', 'gw', 'api', 'db', 'log'])
  })

  it('draws only what the view draws', () => {
    const shop = docs.checkout!
    const view = shop.views.find((v) => v.nodeIds.length < Object.keys(shop.nodes).length)
    expect(view).toBeDefined()
    const ids = outlineNodes(buildOutline(shop, view!)).map((n) => n.id)
    expect(ids.sort()).toEqual([...view!.nodeIds].sort())
  })
})

describe('buildOutline with nodes that hold diagrams', () => {
  const shop = docs['nest-shop']!
  const diagrams = shop.nested!
  const view = shop.views[0]!

  it('says what a node holds, folded', () => {
    const orders = outlineNodes(buildOutline(shop, view, { diagrams })).find(
      (n) => n.id === 'orders',
    )!
    expect(orders.inside).toMatchObject({ expand: true, open: true, expanded: false, items: [] })
    expect(
      outlineNodes(buildOutline(shop, view, { diagrams })).find((n) => n.id === 'browser')!.inside,
    ).toBeUndefined()
  })

  it('lists the nodes of a diagram shown in place, under paths that include the node', () => {
    const tree = buildOutline(shop, view, { diagrams, expanded: new Set(['orders']) })
    const orders = outlineNodes(tree).find((n) => n.id === 'orders')!
    expect(orders.inside!.expanded).toBe(true)
    const inner = outlineNodes(orders.inside!.items)
    expect(inner.length).toBeGreaterThan(0)
    expect(inner.every((n) => n.path.startsWith('orders/'))).toBe(true)
    // The whole outline reaches them too.
    expect(outlineNodes(tree).filter((n) => n.path.startsWith('orders/'))).toEqual(inner)
  })

  it('does not follow a node into a diagram it cannot show', () => {
    const tree = buildOutline(shop, view, { diagrams: {}, expanded: new Set(['orders']) })
    expect(outlineNodes(tree).find((n) => n.id === 'orders')!.inside).toBeUndefined()
  })
})

describe('phaseSpans', () => {
  const d = small()
  const scenario = d.scenarios[0]!

  it('is one run of steps per phase, with its first and last step', () => {
    expect(phaseSpans(scenario).map((p) => [p.title, p.from, p.to, p.count])).toEqual([
      ['One', 0, 1, 2],
      ['Two', 2, 4, 3],
    ])
  })

  it('is one nameless phase for a scenario written as plain steps', () => {
    const r = compileText(`title: T
nodes: { a: A, b: B }
edges: [a -> b]
scenarios:
  s:
    title: S
    steps: [a -> b, b -> a]
`)
    const spans = phaseSpans(r.diagram!.scenarios[0]!)
    expect(spans.map((p) => [p.title, p.count])).toEqual([['', 2]])
  })
})
