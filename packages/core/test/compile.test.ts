import { describe, expect, it } from 'vitest'
import { compileText, loadDocs } from './helpers'

describe('checkout example', () => {
  const project = loadDocs()
  const diagram = project.diagrams.checkout!

  it('compiles without errors', () => {
    expect(project.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(diagram).toBeDefined()
  })

  it('resolves icons for every node', () => {
    const missing = Object.values(diagram.nodes).filter((n) => !n.icon)
    expect(missing.map((n) => n.id)).toEqual([])
  })

  it('renders node docs from nodes/<id>.md', () => {
    expect(diagram.nodes.orders!.docHtml).toContain('<table>')
    expect(diagram.nodes.gateway!.docHtml).toContain('<li>')
  })

  it('builds a view from a group include', () => {
    const backend = diagram.views.find((v) => v.id === 'backend')!
    expect(backend.nodeIds).toContain('orders')
    expect(backend.nodeIds).toContain('stripe')
    expect(backend.nodeIds).not.toContain('browser')
    expect(backend.groupIds).not.toContain('edge')
  })

  it('assigns letter keys to edges when asked', () => {
    const overview = diagram.views.find((v) => v.id === 'overview')!
    expect(Object.values(overview.keys).slice(0, 3)).toEqual(['A', 'B', 'C'])
  })

  it('routes multi-hop steps along declared edges', () => {
    const browse = diagram.scenarios.find((s) => s.id === 'browse')!
    const first = browse.steps[0]!
    expect(first.hops.map((h) => `${h.from}>${h.to}`)).toEqual(['browser>cdn', 'cdn>gateway'])
    expect(first.hops.every((h) => !h.reverse)).toBe(true)
  })

  it('flies against an edge and calls it a response', () => {
    const browse = diagram.scenarios.find((s) => s.id === 'browse')!
    const ok = browse.steps.find((s) => s.label === 'valid')!
    expect(ok.hops).toHaveLength(1)
    expect(ok.hops[0]!.reverse).toBe(true)
    expect(ok.kind).toBe('response')
    const answer = browse.steps.at(-1)!
    expect(answer.hops.map((h) => h.to)).toEqual(['gateway', 'cdn', 'browser'])
  })

  it('numbers steps and groups par steps', () => {
    const order = diagram.scenarios.find((s) => s.id === 'place-order')!
    expect(order.steps.map((s) => s.n)).toEqual(order.steps.map((_, i) => i + 1))
    const par = order.steps.filter((s) => s.par !== undefined)
    expect(par).toHaveLength(2)
    expect(par[0]!.par).toBe(par[1]!.par)
  })
})

describe('diagnostics', () => {
  const base = `title: T
nodes:
  api: { title: API }
  db: { title: DB }
`

  it('reports YAML syntax errors with a location', () => {
    const r = compileText('title: T\nnodes:\n  a: [unclosed\n')
    expect(r.diagram).toBeUndefined()
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', file: 't.yaml' })
    expect(r.diagnostics[0]!.line).toBeGreaterThan(0)
  })

  it('points at the bad edge endpoint and suggests the right id', () => {
    const r = compileText(`${base}edges:\n  - api -> dbb\n`)
    const d = r.diagnostics.find((x) => x.severity === 'error')!
    expect(d.message).toContain('"dbb"')
    expect(d.hint).toContain('"db"')
    expect(d.line).toBe(6)
  })

  it('reports an alias with no anchor instead of throwing', () => {
    const r = compileText('title: T\nnodes:\n  a: { kind: *x }\n')
    expect(r.diagram).toBeUndefined()
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', file: 't.yaml' })
    expect(r.diagnostics[0]!.message).toContain('Unresolved alias')
  })

  it('rejects unknown keys and suggests the intended one', () => {
    const r = compileText('title: T\nnodes:\n  api: { titel: API }\n')
    const d = r.diagnostics[0]!
    expect(d.message).toContain('Unknown key "titel"')
    expect(d.hint).toContain('title')
    expect(d.line).toBe(3)
    // The column is the unknown key, not the node that holds it.
    expect(d.col).toBe(10)
  })

  it('points at the unknown key when it is on its own line', () => {
    const r = compileText('title: T\nnodes:\n  api:\n    kind: service\n    titel: API\n')
    expect(r.diagnostics[0]).toMatchObject({ line: 5, col: 5 })
  })

  it('reports a step with no route', () => {
    const r = compileText(`${base}scenarios:\n  s:\n    title: S\n    steps:\n      - api -> db\n`)
    expect(r.diagnostics[0]!.message).toContain('No path from "api" to "db"')
  })

  it('warns about unknown icons with suggestions', () => {
    const r = compileText('title: T\nnodes:\n  a: { icon: postgresq }\n')
    const w = r.diagnostics.find((d) => d.severity === 'warning')!
    expect(w.message).toContain('Unknown icon')
    expect(w.hint).toContain('postgresql')
    expect(r.diagram).toBeDefined()
  })

  it('accepts shorthand nodes, compact edges and both-way arrows', () => {
    const r = compileText(`title: T
nodes:
  a: Alpha
  b: Beta
edges:
  - a <-> b: sync
`)
    expect(r.diagnostics).toEqual([])
    const e = Object.values(r.diagram!.edges)[0]!
    expect(e).toMatchObject({ from: 'a', to: 'b', both: true, label: 'sync' })
    expect(r.diagram!.nodes.a!.title).toBe('Alpha')
  })

  it('merges scenarios from separate files', () => {
    const r = compileText(`${base}edges:\n  - api -> db\n`, {
      scenarioFiles: [
        { id: 'q', file: 'scenarios/q.yaml', text: 'title: Q\nsteps:\n  - api -> db: SELECT\n' },
      ],
    })
    expect(r.diagnostics).toEqual([])
    expect(r.diagram!.scenarios.map((s) => s.id)).toEqual(['q'])
  })

  it('attributes errors in a scenario file to that file', () => {
    const r = compileText(`${base}edges:\n  - api -> db\n`, {
      scenarioFiles: [
        { id: 'q', file: 'scenarios/q.yaml', text: 'title: Q\nsteps:\n  - api -> ghost\n' },
      ],
    })
    const d = r.diagnostics.find((x) => x.severity === 'error')!
    expect(d.file).toBe('scenarios/q.yaml')
    expect(d.message).toContain('"ghost"')
  })
})

describe('entities', () => {
  const entities = `title: T
nodes:
  customers:
    kind: entity
    fields:
      - id: { type: uuid, key: true }
      - email: text
      - meta.version: integer
      - notes
      - nothing:
  orders:
    kind: entity
    pill: TABLE
    fields:
      - id: { type: uuid, key: true, note: The key. }
      - customer_id: { type: uuid, ref: customers.id }
      - name: text
      - type
  plain: { title: Plain }
`
  const errors = (text: string) =>
    compileText(text).diagnostics.filter((d) => d.severity === 'error')

  it('reads the three shapes of a field', () => {
    const r = compileText(entities)
    expect(errors(entities)).toEqual([])
    expect(r.diagram!.nodes.customers!.fields).toEqual([
      { name: 'id', type: 'uuid', key: true },
      { name: 'email', type: 'text' },
      { name: 'meta.version', type: 'integer' },
      { name: 'notes' },
      { name: 'nothing' },
    ])
    expect(r.diagram!.nodes.orders!.fields[0]).toEqual({
      name: 'id',
      type: 'uuid',
      key: true,
      note: 'The key.',
    })
  })

  it('lets a field be called name or type', () => {
    const orders = compileText(entities).diagram!.nodes.orders!
    expect(orders.fields.slice(2)).toEqual([{ name: 'name', type: 'text' }, { name: 'type' }])
  })

  it('keeps the pill, and makes entity cards wider', () => {
    const { nodes } = compileText(entities).diagram!
    expect(nodes.orders!.pill).toBe('TABLE')
    expect(nodes.orders!.w).toBe(280)
    expect(nodes.plain!.w).toBeUndefined()
    expect(nodes.plain!.fields).toEqual([])
  })

  it('draws a relation for a ref and keeps the ref on the field', () => {
    const d = compileText(entities).diagram!
    expect(d.nodes.orders!.fields[1]!.ref).toEqual({ node: 'customers', field: 'id' })
    expect(Object.values(d.edges)).toEqual([
      expect.objectContaining({
        id: 'ref:orders.customer_id',
        from: 'orders',
        to: 'customers',
        fromField: 'customer_id',
        toField: 'id',
        kind: 'relation',
      }),
    ])
    expect(d.views[0]!.edgeIds).toEqual(['ref:orders.customer_id'])
  })

  it('takes an edge written by hand in place of the one a ref would draw', () => {
    const r = compileText(`${entities}edges:\n  - orders.customer_id -> customers.id: N:1\n`)
    expect(errors(entities)).toEqual([])
    const edges = Object.values(r.diagram!.edges)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({
      label: 'N:1',
      from: 'orders',
      fromField: 'customer_id',
      to: 'customers',
      toField: 'id',
    })
    // The same, the other way round.
    const back = compileText(`${entities}edges:\n  - customers.id -> orders.customer_id\n`)
    expect(Object.keys(back.diagram!.edges)).toEqual(['e1'])
  })

  it('accepts a ref to a node, and one to its own node without drawing it', () => {
    const r = compileText(`title: T
nodes:
  tree: { fields: [{ parent: { ref: tree.id } }, id] }
  leaf: { fields: [{ tree: { ref: tree } }] }
`)
    expect(r.diagnostics).toEqual([])
    expect(r.diagram!.nodes.leaf!.fields[0]!.ref).toEqual({ node: 'tree' })
    expect(Object.keys(r.diagram!.edges)).toEqual(['ref:leaf.tree'])
  })

  it('resolves dotted field names and lets a node id win', () => {
    const r = compileText(`title: T
nodes:
  a: { fields: [meta.version, id] }
  b: { fields: [x] }
  a.id: { title: A dot id }
edges:
  - b.x -> a.meta.version
  - b.x -> a.id
`)
    expect(r.diagnostics).toEqual([])
    const [first, second] = Object.values(r.diagram!.edges)
    expect(first).toMatchObject({ to: 'a', toField: 'meta.version' })
    expect(second).toMatchObject({ to: 'a.id', toField: undefined })
  })

  it('names an unknown node in a ref and suggests the right one', () => {
    const d = errors(entities.replace('ref: customers.id', 'ref: customer.id'))[0]!
    expect(d.message).toBe('Field "customer_id" points at "customer.id", which is not a node')
    expect(d.hint).toBe('Did you mean "customers"?')
    expect(d.line).toBeGreaterThan(0)
  })

  it('names an unknown field and suggests the right one', () => {
    const d = errors(entities.replace('ref: customers.id', 'ref: customers.idd'))[0]!
    expect(d.message).toBe('Node "customers" has no field "idd"')
    expect(d.hint).toBe('Did you mean "id"?')
    const edge = errors(`${entities}edges:\n  - orders.customer_id -> customers.emial\n`)[0]!
    expect(edge.message).toBe('Node "customers" has no field "emial"')
    expect(edge.hint).toBe('Did you mean "email"?')
    expect(edge.path).toBe('edges.0.to')
  })

  it('keeps the old message for an edge to something that is not a node', () => {
    const d = errors(`${entities}edges:\n  - orders -> custmers\n`)[0]!
    expect(d.message).toBe('Edge to "custmers" is not a node')
    expect(d.hint).toBe('Did you mean "customers"?')
  })

  it('refuses a field twice and two fields in one item', () => {
    const twice = errors('title: T\nnodes:\n  a: { fields: [id, { id: text }] }\n')[0]!
    expect(twice.message).toBe('Field "id" appears twice in "a"')
    const both = errors('title: T\nnodes:\n  a: { fields: [{ id: text, name: text }] }\n')[0]!
    expect(both.message).toContain('One field per list item')
  })

  it('refuses an unknown option on a field', () => {
    const d = errors('title: T\nnodes:\n  a: { fields: [{ id: { tpye: uuid } }] }\n')[0]!
    expect(d.message).toContain('"tpye"')
  })
})

describe('edges between entities', () => {
  const text = (edge: string) => `title: T
nodes:
  a: { fields: [id] }
  b: { fields: [a_id] }
  svc: { title: Service }
edges:
  - ${edge}
`
  const kindOf = (edge: string) => Object.values(compileText(text(edge)).diagram!.edges)[0]!.kind

  it('are relations unless they say otherwise', () => {
    expect(kindOf('b.a_id -> a.id')).toBe('relation')
    expect(kindOf('b -> a')).toBe('relation')
    expect(kindOf('{ from: b, to: a, kind: data }')).toBe('data')
  })

  it('stay requests when a service is at one end', () => {
    expect(kindOf('svc -> a')).toBe('http')
    expect(kindOf('b -> svc')).toBe('http')
  })
})
