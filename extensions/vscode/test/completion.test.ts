import { describe, expect, it } from 'vitest'
import {
  type Completion,
  type CompletionRequest,
  complete,
  type ProjectIds,
} from '../src/language/completion'
import { at } from './helpers/cursor'
import { icons } from './helpers/project'

const ids: ProjectIds = {
  nodes: [
    { id: 'web', detail: 'Web app' },
    { id: 'api', detail: 'API' },
    { id: 'db', detail: 'Database' },
  ],
  groups: [{ id: 'backend', detail: 'Backend' }],
  views: [{ id: 'main', detail: 'Main' }],
  customKinds: ['partner'],
  customEdgeKinds: ['batch'],
  docs: ['nodes/api.md'],
  diagrams: [
    { id: 'orders', detail: 'Order service' },
    { id: 'payments', detail: 'Payments' },
  ],
}

const catalog = {
  search: (q: string, limit?: number) => icons.searchIcons(q, limit),
  resolve: (spec: string) => {
    const icon = icons.resolveIcon(spec).icon
    return icon ? `${icon.set}:${icon.name}` : undefined
  },
}

function run(marked: string, file: 'diagram' | 'scenario' = 'diagram'): Completion | undefined {
  const { text, pos } = at(marked)
  const req: CompletionRequest = { text, position: pos, file, ids, icons: catalog }
  return complete(req)
}
const labels = (c: Completion | undefined) => c?.items.map((i) => i.label) ?? []

describe('diagram', () => {
  it('is a node key, documented', () => {
    const c = run('nodes:\n  api:\n    |')
    expect(c?.items.find((i) => i.label === 'diagram')?.documentation).toMatch(/Look inside/)
  })

  it('offers the other diagrams of the project after it', () => {
    const c = run('nodes:\n  api:\n    diagram: |')
    expect(labels(c)).toEqual(['orders', 'payments'])
    expect(c?.items[0]).toMatchObject({ kind: 'diagram', detail: 'Order service' })
  })

  it('offers nothing inside the long form, whose view and scenario belong to another diagram', () => {
    expect(labels(run('nodes:\n  api:\n    diagram: { name: orders, view: | }'))).toEqual([])
  })
})

describe('keys', () => {
  it('offers the root keys', () => {
    expect(labels(run('|'))).toEqual(
      expect.arrayContaining(['title', 'nodes', 'edges', 'scenarios']),
    )
  })

  it('offers node keys and leaves out the ones already written', () => {
    const l = labels(run('nodes:\n  api:\n    kind: service\n    |'))
    expect(l).toEqual(expect.arrayContaining(['title', 'sub', 'icon', 'in', 'status']))
    expect(l).not.toContain('kind')
  })

  it('documents them and asks for the value next', () => {
    const c = run('nodes:\n  api:\n    |')
    const sub = c?.items.find((i) => i.label === 'sub')
    expect(sub?.documentation).toMatch(/mono/)
    expect(sub?.insertText).toBe('sub: ')
    expect(sub?.retrigger).toBe(true)
  })

  it('offers the keys of the right mapping at every depth', () => {
    expect(labels(run('groups:\n  g:\n    |'))).toEqual(
      expect.arrayContaining(['label', 'caption', 'rows']),
    )
    expect(labels(run('views:\n  v:\n    |'))).toEqual(
      expect.arrayContaining(['include', 'exclude', 'direction']),
    )
    expect(labels(run('scenarios:\n  s:\n    |'))).toEqual(
      expect.arrayContaining(['title', 'steps', 'phases', 'mode']),
    )
    expect(labels(run('scenarios:\n  s:\n    phases:\n      - |'))).toEqual(
      expect.arrayContaining(['title', 'steps']),
    )
    expect(labels(run('scenarios:\n  s:\n    steps:\n      - { |'))).toEqual(
      expect.arrayContaining(['from', 'to', 'label', 'via']),
    )
  })

  it('offers scenario keys at the root of a scenario file', () => {
    expect(labels(run('|', 'scenario'))).toEqual(
      expect.arrayContaining(['title', 'steps', 'phases', 'summary']),
    )
    expect(labels(run('|', 'scenario'))).not.toContain('nodes')
  })

  it('leaves out from and to after the arrow of a compact edge', () => {
    const l = labels(run('edges:\n  - a -> b:\n      |'))
    expect(l).toContain('label')
    expect(l).not.toContain('from')
    expect(labels(run('edges:\n  - |'))).toEqual(expect.arrayContaining(['web', 'from', 'to']))
  })

  it('offers nothing where keys are not expected', () => {
    expect(run('nodes:\n  |')).toBeUndefined()
    expect(run('# comment |')).toBeUndefined()
    expect(run('description: |\n  text |')).toBeUndefined()
  })

  it('replaces the word being typed', () => {
    const c = run('nodes:\n  api:\n    ti|')
    expect(c?.range).toEqual({ line: 2, start: 4, end: 6 })
  })
})

describe('values', () => {
  it("offers node kinds, including the diagram's own", () => {
    const l = labels(run('nodes:\n  api:\n    kind: |'))
    expect(l).toEqual(expect.arrayContaining(['service', 'database', 'partner']))
  })

  it('offers edge kinds and step kinds by context', () => {
    expect(labels(run('edges:\n  - { from: a, to: b, kind: |'))).toEqual(
      expect.arrayContaining(['http', 'queue', 'batch']),
    )
    expect(labels(run('scenarios:\n  s:\n    steps:\n      - a -> b: { kind: |'))).toEqual(
      expect.arrayContaining(['request', 'response', 'lookup']),
    )
  })

  it('offers enumerations from the schema', () => {
    expect(labels(run('nodes:\n  a:\n    status: |'))).toEqual([
      'built',
      'planned',
      'legacy',
      'optional',
    ])
    expect(labels(run('nodes:\n  a:\n    family: |'))).toContain('violet')
    expect(labels(run('views:\n  v:\n    direction: |'))).toEqual(
      expect.arrayContaining(['AUTO', 'RIGHT']),
    )
    expect(labels(run('scenarios:\n  s:\n    mode: |'))).toEqual(['flow', 'sequence', 'story'])
    expect(labels(run('groups:\n  g:\n    layout: |'))).toEqual(['flow', 'row', 'grid'])
  })

  it('offers true and false for flags', () => {
    expect(labels(run('edges:\n  - { from: a, to: b, both: |'))).toEqual(['true', 'false'])
  })

  it('offers groups for in:, nodes for from/to/at/via, views for view:', () => {
    expect(labels(run('nodes:\n  a:\n    in: |'))).toEqual(['backend'])
    // Edges join nodes: a group is only valid for in:, include: and exclude:.
    expect(labels(run('edges:\n  - from: |'))).toEqual(['web', 'api', 'db'])
    expect(labels(run('scenarios:\n  s:\n    steps:\n      - at: |'))).toContain('db')
    expect(labels(run('scenarios:\n  s:\n    steps:\n      - { from: a, to: b, via: [|'))).toEqual(
      expect.arrayContaining(['web']),
    )
    expect(labels(run('scenarios:\n  s:\n    view: |'))).toEqual(['main'])
    expect(labels(run('views:\n  v:\n    include: [|'))).toEqual(
      expect.arrayContaining(['all', 'web', 'backend']),
    )
  })

  it('offers lane nodes', () => {
    expect(labels(run('scenarios:\n  s:\n    lanes:\n      - { title: A, nodes: [|'))).toEqual(
      expect.arrayContaining(['web', 'api']),
    )
  })

  it('offers documentation files', () => {
    expect(labels(run('nodes:\n  a:\n    doc: |'))).toEqual(['nodes/api.md'])
  })

  it('offers nothing for free text', () => {
    expect(run('nodes:\n  a:\n    title: |')).toBeUndefined()
  })
})

describe('shorthand', () => {
  it('starts an edge with a node and asks for the arrow', () => {
    const c = run('edges:\n  - |')
    const web = c?.items.find((i) => i.label === 'web')
    expect(web?.insertText).toBe('web -> ')
    expect(web?.retrigger).toBe(true)
  })

  it('offers the other end after an arrow, not the node itself', () => {
    const l = labels(run('edges:\n  - web -> |'))
    expect(l).toEqual(expect.arrayContaining(['api', 'db']))
    // A request cannot go to a group, and the compiler rejects an edge that tries.
    expect(l).not.toContain('backend')
    expect(l).not.toContain('web')
  })

  it('offers the same in steps, with at and par', () => {
    const l = labels(run('scenarios:\n  s:\n    steps:\n      - |'))
    expect(l).toEqual(expect.arrayContaining(['web', 'at', 'par']))
    expect(labels(run('scenarios:\n  s:\n    steps:\n      - api -> |'))).toContain('db')
    expect(labels(run('steps:\n  - api -> |', 'scenario'))).toContain('db')
  })

  it('replaces the partial target', () => {
    const c = run('edges:\n  - web -> ap|')
    expect(c?.range).toEqual({ line: 1, start: 11, end: 13 })
  })
})

describe('icons', () => {
  it('suggests icon sets when nothing is typed', () => {
    expect(labels(run('nodes:\n  a:\n    icon: |'))).toEqual(['lucide:', 'logos:', 'simple-icons:'])
  })

  it('searches the catalog', () => {
    const c = run('nodes:\n  a:\n    icon: postgre|')
    expect(labels(c)).toContain('postgresql')
    const first = c?.items.find((i) => i.label === 'postgresql')
    expect(first?.detail).toBe('logos:postgresql')
  })

  it('keeps the set when one is typed', () => {
    const l = labels(run('nodes:\n  a:\n    icon: lucide:serv|'))
    expect(l.length).toBeGreaterThan(0)
    expect(l.every((x) => x.startsWith('lucide:'))).toBe(true)
  })

  it('stays quiet after a bare set name', () => {
    expect(run('nodes:\n  a:\n    icon: lucide:|')).toBeUndefined()
  })
})

describe('where a value is welcome', () => {
  it('does not suggest values for a node that happens to be named like a key', () => {
    expect(run('nodes:\n  status: Status page|')).toBeUndefined()
    expect(run('nodes:\n  view: |')).toBeUndefined()
    expect(run('nodes:\n  in: |')).toBeUndefined()
  })

  it('does not suggest values for a key inside a list of plain text', () => {
    expect(run('nodes:\n  a:\n    lines:\n      - kind: |')).toBeUndefined()
  })

  it('still suggests them for the real key', () => {
    expect(labels(run('nodes:\n  a:\n    status: |'))).toContain('planned')
  })

  it('knows the mapping a flow collection belongs to after a compact key', () => {
    const l = labels(run('edges:\n  - web -> api: { |'))
    expect(l).toContain('label')
    expect(l).not.toContain('from')
    expect(labels(run('scenarios:\n  s:\n    steps:\n      - web -> api: { |'))).toContain('via')
    expect(labels(run('scenarios:\n  s:\n    steps:\n      - web -> api: { kind: |'))).toContain(
      'lookup',
    )
  })
})

describe('completing right after a colon', () => {
  it('inserts the space the colon is missing', () => {
    const c = run('nodes:\n  a:\n    kind:|')
    expect(c?.items[0]?.insertText?.startsWith(' ')).toBe(true)
    expect(c?.items.find((i) => i.label === 'service')).toMatchObject({
      insertText: ' service',
      filterText: 'service',
    })
  })

  it('adds nothing when the space is already there', () => {
    const c = run('nodes:\n  a:\n    kind: |')
    expect(c?.items.find((i) => i.label === 'service')?.insertText).toBeUndefined()
  })

  it('does the same inside a flow mapping', () => {
    const c = run('edges:\n  - a -> b: { kind:|')
    expect(c?.items.find((i) => i.label === 'queue')?.insertText).toBe(' queue')
  })
})
