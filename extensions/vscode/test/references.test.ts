import { describe, expect, it } from 'vitest'
import { declarationsOf } from '../src/model/declarations'
import {
  declarationOf,
  isUseOf,
  type Reference,
  referencesIn,
  symbolAt,
} from '../src/model/references'
import { Parsed } from '../src/model/yaml'
import { at } from './helpers/cursor'

const DIAGRAM = `title: Shop
groups:
  backend:
    label: Backend
    rows: [[api], [db]]
  inner: { label: Inner, in: backend }
nodes:
  web: Web
  api: { kind: service, in: backend }
  db: { kind: database, in: backend }
edges:
  - web -> api: HTTPS
  - api <-> db
  - { from: api, to: db, label: SQL }
  - "web -> db"
views:
  main: { include: [web, backend], exclude: [db] }
  all: { include: all }
scenarios:
  load:
    title: Load
    view: main
    lanes:
      - { title: Client, nodes: [web] }
    phases:
      - title: Go
        steps:
          - web -> api: GET
          - at api: check
          - par:
              - api -> db
              - { from: api, to: web, via: [db] }
    steps:
      - a: 1
`

function refs(text: string, file: 'diagram' | 'scenario' = 'diagram') {
  return referencesIn(new Parsed(text), file).map((r) => `${r.kind}:${r.id}`)
}

describe('referencesIn', () => {
  it('finds the references in every form', () => {
    const found = refs(DIAGRAM)
    // groups
    expect(found).toContain('member:api')
    // group parents and node groups
    expect(found.filter((r) => r === 'group:backend')).toHaveLength(3)
    // edges: shorthand, two-way, object, quoted
    expect(found.filter((r) => r === 'member:web')).toEqual(expect.arrayContaining(['member:web']))
    // views and scenario
    expect(found).toContain('view:main')
    expect(found).not.toContain('member:all')
  })

  it('records where an id is written inside an arrow', () => {
    const parsed = new Parsed('edges:\n  - web -> api: HTTPS\nnodes: {}\n')
    const all = referencesIn(parsed, 'diagram')
    expect(
      all.map((r) => [r.id, r.span.start.line, r.span.start.character, r.span.end.character]),
    ).toEqual([
      ['web', 1, 4, 7],
      ['api', 1, 11, 14],
    ])
  })

  it('covers steps, self steps, parallel steps, via and lanes', () => {
    const ids = referencesIn(new Parsed(DIAGRAM), 'diagram')
    const inScenario = ids.filter((r) => r.span.start.line >= 19).map((r) => r.id)
    expect(inScenario).toEqual(expect.arrayContaining(['web', 'api', 'db']))
    // `at api: check` is a use of api
    const lines = DIAGRAM.split('\n')
    const selfLine = lines.findIndex((l) => l.includes('at api: check'))
    expect(ids.some((r) => r.span.start.line === selfLine && r.id === 'api')).toBe(true)
    // via: [db] on the object form inside par
    const viaLine = lines.findIndex((l) => l.includes('via: [db]'))
    expect(ids.some((r) => r.span.start.line === viaLine && r.id === 'db')).toBe(true)
  })

  it('reads a scenario file whose root is the scenario', () => {
    const text = 'title: Extra\nview: main\nsteps:\n  - web -> api: x\n  - from: api\n    to: db\n'
    expect(refs(text, 'scenario')).toEqual([
      'view:main',
      'member:web',
      'member:api',
      'member:api',
      'member:db',
    ])
  })

  it('survives a document that does not parse', () => {
    expect(() => referencesIn(new Parsed('edges: [\n  - a ->'), 'diagram')).not.toThrow()
    expect(refs('')).toEqual([])
  })
})

describe('symbolAt', () => {
  const parsed = new Parsed(DIAGRAM)
  const declarations = declarationsOf(parsed)
  const all = referencesIn(parsed, 'diagram')

  function symbol(marked: string) {
    const { text, pos } = at(marked)
    const p = new Parsed(text)
    return symbolAt(pos, referencesIn(p, 'diagram'), declarationsOf(p))
  }

  it('is the node under the cursor, in a use or in its declaration', () => {
    expect(symbol('nodes:\n  a|pi: { kind: service }\n')).toMatchObject({
      id: 'api',
      namespace: 'member',
    })
    expect(symbol('nodes:\n  api: {}\nedges:\n  - api -> d|b\n')).toMatchObject({ id: 'db' })
    expect(symbol('edges:\n  - { from: ap|i, to: db }\n')).toMatchObject({ id: 'api' })
  })

  it('treats the end of the word as part of it', () => {
    expect(symbol('edges:\n  - api| -> db\n')).toMatchObject({ id: 'api' })
  })

  it('is nothing on a label or a keyword', () => {
    expect(symbol('edges:\n  - api -> db: SQ|L\n')).toBeUndefined()
    expect(symbol('ti|tle: x\n')).toBeUndefined()
  })

  it('gives views their own namespace', () => {
    expect(symbol('views:\n  main: {}\nscenarios:\n  s:\n    view: ma|in\n')).toMatchObject({
      id: 'main',
      namespace: 'view',
    })
  })

  it('counts the default view as a use of the view', () => {
    expect(symbol('defaults:\n  view: ma|in\nviews:\n  main: {}\n')).toMatchObject({
      id: 'main',
      namespace: 'view',
    })
  })

  it('finds the declaration of a symbol', () => {
    const web = all.find((r) => r.id === 'web')!
    const sym = { id: web.id, namespace: 'member' as const, span: web.span }
    expect(declarationOf(sym, declarations)?.section).toBe('nodes')
    const backend = { id: 'backend', namespace: 'member' as const, span: web.span }
    expect(declarationOf(backend, declarations)?.section).toBe('groups')
  })

  it('knows which references belong to a symbol', () => {
    const sym = { id: 'backend', namespace: 'member' as const, span: all[0]!.span }
    const uses = all.filter((r: Reference) => isUseOf(r, sym))
    // group parent, two nodes, a view include and the group rows are not members of `backend`
    expect(uses.length).toBeGreaterThanOrEqual(3)
    expect(uses.every((u) => u.id === 'backend')).toBe(true)
  })
})

describe('declarationsOf', () => {
  it('lists nodes, groups, views and scenarios with their properties', () => {
    const list = declarationsOf(new Parsed(DIAGRAM))
    const by = (section: string) => list.filter((d) => d.section === section).map((d) => d.id)
    expect(by('nodes')).toEqual(['web', 'api', 'db'])
    expect(by('groups')).toEqual(['backend', 'inner'])
    expect(by('views')).toEqual(['main', 'all'])
    expect(by('scenarios')).toEqual(['load'])
    expect(list.find((d) => d.id === 'web')?.props.title).toBe('Web')
    expect(list.find((d) => d.id === 'api')?.props).toMatchObject({
      kind: 'service',
      in: 'backend',
    })
    expect(list.find((d) => d.id === 'backend')?.props.label).toBe('Backend')
  })

  it('gives the span of the key and of the entry', () => {
    const d = declarationsOf(new Parsed('nodes:\n  api:\n    kind: service\n')).find(
      (x) => x.id === 'api',
    )
    expect(d?.key).toEqual({ start: { line: 1, character: 2 }, end: { line: 1, character: 5 } })
    expect(d?.entry.end.line).toBe(2)
  })

  it('works on broken text', () => {
    expect(declarationsOf(new Parsed('nodes:\n  api: { kind: [\n'))).toBeDefined()
  })

  it('records where an explicit doc: is written', () => {
    const text = 'nodes:\n  api:\n    doc: ./nodes/api.md\n  db: Database\n'
    const list = declarationsOf(new Parsed(text))
    const api = list.find((d) => d.id === 'api')
    expect(api?.props.doc).toBe('./nodes/api.md')
    expect(api?.docSpan).toEqual({
      start: { line: 2, character: 9 },
      end: { line: 2, character: 23 },
    })
    expect(list.find((d) => d.id === 'db')?.docSpan).toBeUndefined()
  })
})
