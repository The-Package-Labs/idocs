import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import {
  authoringJsonSchema,
  type Diagnostic,
  formatDiagnostic,
  loadProject,
  resolveIcon,
  searchIcons,
} from '@the-package-labs/idocs-core/node'

const HELP = `idocs: interactive diagrams for your docs

Usage
  idocs check [root...] [--json] [--strict]  Validate every diagram under <root>/diagrams
  idocs list [root] [--json]               List diagrams, views and scenarios
  idocs schema [root]                      Write diagrams/diagram.schema.json for editor autocomplete
  idocs icons search <query>               Find icon names ("postgresql", "logos:redis", ...)
  idocs new <name> [root]                  Create diagrams/<name>/diagram.yaml

<root> is the folder that contains "diagrams/". It defaults to the current folder,
or the first apps/* or templates/* folder that has one.
`

type Flags = { json: boolean; strict: boolean }

export async function run(argv: string[]): Promise<number> {
  const flags: Flags = { json: argv.includes('--json'), strict: argv.includes('--strict') }
  const args = argv.filter((a) => !a.startsWith('--'))
  const [command, ...rest] = args

  switch (command) {
    case 'check':
      return check(rest.length ? rest.map((r) => findRoot(r)) : [findRoot()], flags)
    case 'list':
      return list(findRoot(rest[0]), flags)
    case 'schema':
      return schema(findRoot(rest[0]))
    case 'icons':
      return icons(rest[0] === 'search' ? rest.slice(1).join(' ') : rest.join(' '), flags)
    case 'new':
      return create(rest[0], findRoot(rest[1]))
    case undefined:
    case 'help':
      console.log(HELP)
      return 0
    default:
      console.error(`Unknown command "${command}"\n\n${HELP}`)
      return 2
  }
}

function findRoot(arg?: string): string {
  if (arg) return resolve(arg)
  const cwd = process.cwd()
  if (existsSync(join(cwd, 'diagrams'))) return cwd
  for (const parent of ['apps', 'templates']) {
    const base = join(cwd, parent)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base).sort()) {
      if (existsSync(join(base, name, 'diagrams'))) return join(base, name)
    }
  }
  return cwd
}

/** `src/api.ts`, `src/api.ts:40`, `src/api.ts#L40`. URLs and bare words are left alone. */
function refPath(ref: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) return undefined
  const path = ref.replace(/(#L?\d+(-L?\d+)?|:\d+(-\d+)?)$/, '')
  return /[/.]/.test(path) ? path : undefined
}

/** Warn when a node cites a source file that no longer exists: a sign the diagram has gone stale. */
export function staleRefs(project: ReturnType<typeof loadProject>, bases: string[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const [name, d] of Object.entries(project.diagrams)) {
    for (const node of Object.values(d.nodes)) {
      for (const ref of node.refs) {
        const path = refPath(ref)
        if (!path || bases.some((b) => existsSync(resolve(b, path)))) continue
        out.push({
          severity: 'warning',
          message: `Node "${node.id}" cites "${ref}", which does not exist`,
          file: `diagrams/${name}/diagram.yaml`,
          hint: 'The code may have moved. Update the diagram or the reference.',
        })
      }
    }
  }
  return out
}

function check(roots: string[], flags: Flags): number {
  const results = roots.map((root) => {
    const project = loadProject(root)
    project.diagnostics.push(...staleRefs(project, [root, process.cwd()]))
    const errors = project.diagnostics.filter((d) => d.severity === 'error')
    const warnings = project.diagnostics.filter((d) => d.severity === 'warning')
    const ok = errors.length === 0 && !(flags.strict && warnings.length)
    return { root, project, errors, warnings, ok }
  })
  const ok = results.every((r) => r.ok)

  if (flags.json) {
    const out = results.map((r) => ({
      ok: r.ok,
      root: r.root,
      diagrams: summarise(r.project.diagrams),
      diagnostics: r.project.diagnostics,
    }))
    console.log(JSON.stringify(out.length === 1 ? out[0] : { ok, projects: out }, null, 2))
    return ok ? 0 : 1
  }

  for (const r of results) {
    for (const d of sortDiagnostics(r.project.diagnostics)) console.log(formatDiagnostic(d))
    const names = Object.keys(r.project.diagrams)
    console.log(
      `${names.length} diagram${names.length === 1 ? '' : 's'} compiled in ${relative(process.cwd(), r.root) || '.'}: ` +
        `${r.errors.length} error${r.errors.length === 1 ? '' : 's'}, ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}`,
    )
    if (names.length === 0 && r.errors.length === 0)
      console.log('No diagrams found. Create one with `idocs new <name>`.')
  }
  return ok ? 0 : 1
}

function sortDiagnostics(list: Diagnostic[]): Diagnostic[] {
  return [...list].sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
}

function summarise(diagrams: ReturnType<typeof loadProject>['diagrams']) {
  return Object.fromEntries(
    Object.entries(diagrams).map(([name, d]) => [
      name,
      {
        title: d.title,
        nodes: Object.keys(d.nodes).length,
        edges: Object.keys(d.edges).length,
        views: d.views.map((v) => v.id),
        scenarios: d.scenarios.map((s) => ({ id: s.id, view: s.view, steps: s.steps.length })),
        opens: Object.values(d.nodes)
          .filter((n) => n.diagram)
          .map((n) => ({ node: n.id, diagram: n.diagram!.name })),
      },
    ]),
  )
}

function list(root: string, flags: Flags): number {
  const project = loadProject(root)
  const summary = summarise(project.diagrams)
  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2))
    return 0
  }
  for (const [name, s] of Object.entries(summary)) {
    console.log(`${name}  ${s.title}`)
    console.log(`  ${s.nodes} nodes, ${s.edges} edges`)
    console.log(`  views:     ${s.views.join(', ')}`)
    console.log(
      `  scenarios: ${s.scenarios.map((x) => `${x.id} (${x.steps})`).join(', ') || 'none'}`,
    )
    if (s.opens.length)
      console.log(`  opens:     ${s.opens.map((o) => `${o.node} → ${o.diagram}`).join(', ')}`)
  }
  return 0
}

function schema(root: string): number {
  const dir = join(root, 'diagrams')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'diagram.schema.json')
  writeFileSync(file, `${JSON.stringify(authoringJsonSchema(), null, 2)}\n`)
  console.log(`Wrote ${relative(process.cwd(), file) || file}`)
  console.log(
    'Reference it from a diagram with:\n  # yaml-language-server: $schema=../diagram.schema.json',
  )
  return 0
}

function icons(query: string, flags: Flags): number {
  if (!query) {
    console.error('Usage: idocs icons search <query>')
    return 2
  }
  const hits = searchIcons(query, 20)
  const exact = resolveIcon(query).icon
  if (flags.json) {
    console.log(
      JSON.stringify(
        { query, resolves: exact ? `${exact.set}:${exact.name}` : null, matches: hits },
        null,
        2,
      ),
    )
    return 0
  }
  if (exact) console.log(`"${query}" resolves to ${exact.set}:${exact.name}\n`)
  if (hits.length === 0) console.log('No matches.')
  for (const h of hits) console.log(h)
  return 0
}

function create(name: string | undefined, root: string): number {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error('Usage: idocs new <name>   (lowercase letters, digits and dashes)')
    return 2
  }
  const dir = join(root, 'diagrams', name)
  if (existsSync(dir)) {
    console.error(`${relative(process.cwd(), dir)} already exists`)
    return 1
  }
  mkdirSync(join(dir, 'nodes'), { recursive: true })
  writeFileSync(join(dir, 'diagram.yaml'), TEMPLATE(name))
  writeFileSync(
    join(dir, 'nodes', 'api.md'),
    'Describe the API here. Markdown is shown in the detail drawer when a reader clicks the box.\n',
  )
  console.log(`Created ${relative(process.cwd(), dir)}`)
  console.log(
    `Use it in a page:\n  import Diagram from '@the-package-labs/idocs-astro/Diagram.astro'\n  <Diagram name="${name}" />`,
  )
  return 0
}

const TEMPLATE = (name: string) => `# yaml-language-server: $schema=../diagram.schema.json
title: ${name}

nodes:
  web:
    kind: client
    title: Web app
  api:
    kind: service
    title: API
    sub: ":8080"
  db:
    kind: database
    icon: postgresql
    title: Database

edges:
  - web -> api: HTTPS
  - api -> db: { kind: data, label: SQL }

scenarios:
  load-page:
    title: Load a page
    steps:
      - web -> api: GET /items
      - api -> db: { label: SELECT, kind: lookup }
      - db -> api: rows
      - api -> web: 200 OK
`
