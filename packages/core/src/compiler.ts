import { type Document, isMap, isSeq, LineCounter, type Node, parseDocument } from 'yaml'
import { BUILTIN_EDGE_KINDS, BUILTIN_KINDS, type KindDef } from './defaults'
import { letterKey } from './geometry'
import { type IconResult, iconFromSvg } from './icon-resolver'
import { renderMarkdown } from './markdown'
import { normalizeRoot } from './normalize'
import { KNOWN_KEYS, type RootInput, RootSchema, type Step } from './schema'
import { didYouMean } from './suggest'
import type {
  CompiledDiagram,
  CompiledEdge,
  CompiledGroup,
  CompiledLane,
  CompiledNode,
  CompiledPhase,
  CompiledScenario,
  CompiledStep,
  CompiledView,
  Direction,
  EdgeKindDef,
  Hop,
  IconData,
  Status,
  StepKind,
} from './types'

export interface Diagnostic {
  severity: 'error' | 'warning'
  message: string
  file: string
  line?: number
  col?: number
  /** Dotted path into the document, e.g. `edges.2.to`. */
  path?: string
  hint?: string
}

export interface DiagramSource {
  /** Directory name; becomes the diagram's name. */
  name: string
  file: string
  text: string
  scenarioFiles?: { id: string; file: string; text: string }[]
  /** Read a file relative to the diagram directory (docs, local icons). Undefined when missing. */
  readFile?: (relPath: string) => string | undefined
}

/** Where a dotted path of the diagram lives in the files it was compiled from. */
export type Where = (path: (string | number)[]) => { file: string; line?: number; col?: number }

export interface CompileResult {
  diagram?: CompiledDiagram
  diagnostics: Diagnostic[]
  /**
   * Lets a later pass (linking diagrams to each other) report at a line. A closure over the parsed
   * files, so it is not enumerable: spreading, cloning or serialising a result leaves it behind.
   */
  readonly where?: Where
}

interface Source {
  file: string
  doc: Document
  lines: LineCounter
}

type Path = (string | number)[]

export interface CompilerAssets {
  resolveIcon: (spec: string) => IconResult
}

export function compileDiagram(src: DiagramSource, assets: CompilerAssets): CompileResult {
  const diagnostics: Diagnostic[] = []
  const main = parse(src.file, src.text, diagnostics)
  if (!main) return { diagnostics }

  const scenarioSources = new Map<string, Source>()
  const rawRoot = toJS(main, diagnostics, { maxAliasCount: 50 })
  if (rawRoot === undefined) return { diagnostics }
  const root = (
    rawRoot && typeof rawRoot === 'object' ? { ...(rawRoot as object) } : rawRoot
  ) as Record<string, unknown>

  for (const f of src.scenarioFiles ?? []) {
    const s = parse(f.file, f.text, diagnostics)
    if (!s) continue
    root.scenarios ??= {}
    const scenarios = root.scenarios as Record<string, unknown>
    if (f.id in scenarios) {
      diagnostics.push({
        severity: 'error',
        message: `Scenario "${f.id}" is defined twice`,
        file: f.file,
      })
      continue
    }
    const body = toJS(s, diagnostics)
    if (body === undefined) continue
    scenarios[f.id] = body
    scenarioSources.set(f.id, s)
  }

  const where: Where = (path) => {
    let source = main
    let p = path
    if (path[0] === 'scenarios' && typeof path[1] === 'string' && scenarioSources.has(path[1])) {
      source = scenarioSources.get(path[1])!
      p = path.slice(2)
    }
    return { file: source.file, ...locate(source, p) }
  }
  const report = (severity: Diagnostic['severity'], message: string, path: Path, hint?: string) => {
    diagnostics.push({ severity, message, ...where(path), path: path.join('.'), hint })
  }
  const error = (message: string, path: Path, hint?: string) => report('error', message, path, hint)
  const warn = (message: string, path: Path, hint?: string) =>
    report('warning', message, path, hint)

  const parsed = RootSchema.safeParse(normalizeRoot(root))
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const { message, hint } = describeIssue(issue)
      const path = issue.path.filter((k): k is string | number => typeof k !== 'symbol')
      // An unknown key is reported on the mapping that holds it; point at the key itself.
      const unknown = issue.code === 'unrecognized_keys' ? issue.keys[0] : undefined
      error(message, unknown === undefined ? path : [...path, unknown], hint)
    }
    return { diagnostics }
  }

  const diagram = build(parsed.data, src, error, warn, assets)
  if (diagnostics.some((d) => d.severity === 'error')) return { diagnostics }
  return Object.defineProperty({ diagram, diagnostics }, 'where', { value: where })
}

type Report = (message: string, path: Path, hint?: string) => void

function build(
  data: RootInput,
  src: DiagramSource,
  error: Report,
  warn: Report,
  { resolveIcon }: CompilerAssets,
): CompiledDiagram {
  const kinds: Record<string, KindDef> = { ...BUILTIN_KINDS }
  for (const [id, k] of Object.entries(data.kinds ?? {})) {
    kinds[id] = {
      icon: k.icon ?? kinds[id]?.icon ?? 'lucide:box',
      family: k.family ?? kinds[id]?.family,
    }
  }
  const edgeKinds: Record<string, EdgeKindDef> = { ...BUILTIN_EDGE_KINDS }
  for (const [id, k] of Object.entries(data.edgeKinds ?? {})) {
    edgeKinds[id] = { label: k.label, color: k.color ?? 'ink', width: k.width ?? 1.5, dash: k.dash }
  }

  const iconCache = new Map<string, IconData | undefined>()
  const iconFor = (spec: string | undefined, path: Path): IconData | undefined => {
    if (!spec) return undefined
    if (iconCache.has(spec)) return iconCache.get(spec)
    let icon: IconData | undefined
    if (/^\.{0,2}\//.test(spec) || spec.endsWith('.svg')) {
      const svg = src.readFile?.(spec)
      icon = svg ? iconFromSvg(svg, spec) : undefined
      if (!icon) warn(`Icon file "${spec}" was not found or is not an SVG`, path)
    } else {
      const res = resolveIcon(spec)
      icon = res.icon
      if (!icon) {
        warn(
          `Unknown icon "${spec}"`,
          path,
          res.suggestions.length
            ? `Did you mean ${res.suggestions.map((s) => `"${s}"`).join(', ')}?`
            : 'Run `idocs icons search <name>` to find one.',
        )
      }
    }
    iconCache.set(spec, icon)
    return icon
  }

  // Groups
  const groups: Record<string, CompiledGroup> = {}
  for (const [id, g] of Object.entries(data.groups ?? {})) {
    if (g.in && !data.groups?.[g.in]) {
      error(
        `Group "${id}" is in unknown group "${g.in}"`,
        ['groups', id, 'in'],
        didYouMean(g.in, Object.keys(data.groups ?? {})),
      )
    }
    groups[id] = {
      id,
      label: g.label,
      caption: g.caption,
      parent: g.in && data.groups?.[g.in] ? g.in : undefined,
      layout: g.rows?.length ? 'rows' : (g.layout ?? 'flow'),
      rows: g.rows,
      columns: g.columns,
      direction: g.direction,
      family: g.family,
      status: g.status ?? 'built',
      style: g.in ? 'frame' : 'zone',
      icon: iconFor(g.icon, ['groups', id, 'icon']),
    }
  }
  for (const [id, g] of Object.entries(data.groups ?? {})) {
    const seenInRows = new Set<string>()
    g.rows?.forEach((row, ri) => {
      row.forEach((member, mi) => {
        const path: Path = ['groups', id, 'rows', ri, mi]
        const isChildNode = data.nodes[member]?.in === id
        const isChildGroup = data.groups?.[member]?.in === id
        if (!isChildNode && !isChildGroup) {
          const options = [
            ...Object.keys(data.nodes).filter((n) => data.nodes[n]!.in === id),
            ...Object.keys(data.groups ?? {}).filter((x) => data.groups?.[x]?.in === id),
          ]
          error(
            `"${member}" is not a direct member of group "${id}"`,
            path,
            didYouMean(member, options) ?? `Members: ${options.join(', ') || 'none'}`,
          )
        } else if (seenInRows.has(member)) error(`"${member}" appears in rows twice`, path)
        seenInRows.add(member)
      })
    })
  }
  for (const id of Object.keys(groups)) {
    const seen = new Set<string>()
    for (let cur: string | undefined = id; cur; cur = groups[cur]?.parent) {
      if (seen.has(cur)) {
        error(`Groups are nested in a cycle at "${id}"`, ['groups', id, 'in'])
        groups[id]!.parent = undefined
        break
      }
      seen.add(cur)
    }
  }
  const fixParents = Object.values(groups)
  for (const g of fixParents) g.style = g.parent ? 'frame' : 'zone'

  // Nodes
  const nodes: Record<string, CompiledNode> = {}
  for (const [id, n] of Object.entries(data.nodes)) {
    if (n.kind && !kinds[n.kind]) {
      warn(
        `Unknown node kind "${n.kind}"`,
        ['nodes', id, 'kind'],
        didYouMean(n.kind, Object.keys(kinds)),
      )
    }
    const kind = n.kind ? kinds[n.kind] : undefined
    if (n.in && !groups[n.in]) {
      error(
        `Node "${id}" is in unknown group "${n.in}"`,
        ['nodes', id, 'in'],
        didYouMean(n.in, Object.keys(groups)),
      )
    }
    if (typeof n.diagram === 'object' && n.diagram.expanded && n.diagram.mode === 'open') {
      warn(
        '`expanded` has no effect with `mode: open`',
        ['nodes', id, 'diagram', 'expanded'],
        'Use `mode: expand` or `mode: both`, or drop `expanded`.',
      )
    }
    const docPath = n.doc ?? `nodes/${id}.md`
    const docText = src.readFile?.(docPath)
    if (n.doc && docText === undefined)
      warn(`Doc file "${n.doc}" was not found`, ['nodes', id, 'doc'])
    const docHtml = [n.description, docText]
      .filter((t): t is string => !!t)
      .map(renderMarkdown)
      .join('')
    nodes[id] = {
      id,
      title: n.title ?? id,
      sub: n.sub,
      lines: n.lines ?? [],
      icon: iconFor(n.icon ?? kind?.icon, ['nodes', id, n.icon ? 'icon' : 'kind']),
      kind: n.kind,
      family: n.family ?? kind?.family,
      group: n.in && groups[n.in] ? n.in : undefined,
      status: n.status ?? 'built',
      badge: n.badge === undefined ? undefined : String(n.badge),
      uses: n.uses ?? [],
      chips: (n.chips ?? []).map((c) => (typeof c === 'string' ? { label: c } : c)),
      w: n.w,
      docHtml: docHtml || undefined,
      links: n.links ?? [],
      refs: n.refs ?? [],
      tags: n.tags ?? [],
      diagram: typeof n.diagram === 'string' ? { name: n.diagram } : n.diagram,
    }
  }

  // Edges
  const edges: Record<string, CompiledEdge> = {}
  const nodeIds = Object.keys(nodes)
  ;(data.edges ?? []).forEach((e, i) => {
    const path: Path = ['edges', i]
    let ok = true
    for (const end of ['from', 'to'] as const) {
      if (!nodes[e[end]]) {
        error(`Edge ${end} "${e[end]}" is not a node`, [...path, end], didYouMean(e[end], nodeIds))
        ok = false
      }
    }
    const kind = e.kind ?? 'http'
    if (!edgeKinds[kind]) {
      error(
        `Unknown edge kind "${kind}"`,
        [...path, 'kind'],
        `Known kinds: ${Object.keys(edgeKinds).join(', ')}`,
      )
      ok = false
    }
    if (e.from === e.to) {
      warn('Edge connects a node to itself and is not drawn', path)
      ok = false
    }
    if (!ok) return
    const id = e.id ?? `e${i + 1}`
    if (edges[id]) {
      error(`Edge id "${id}" is used twice`, [...path, 'id'])
      return
    }
    edges[id] = {
      id,
      from: e.from,
      to: e.to,
      label: e.label,
      kind,
      both: e.both ?? false,
      hidden: e.hidden ?? false,
      status: e.status ?? 'built',
      key: e.key,
      auth: e.auth,
      payload: e.payload,
      transport: e.transport,
      noteHtml: e.note ? renderMarkdown(e.note) : undefined,
    }
  })

  // Views
  const viewDefs = Object.keys(data.views ?? {}).length
    ? data.views!
    : { main: { title: data.title } }
  const views: CompiledView[] = Object.entries(viewDefs).map(([id, v]) =>
    buildView(
      id,
      v as NonNullable<RootInput['views']>[string],
      data.title,
      nodes,
      groups,
      edges,
      error,
    ),
  )

  // Scenarios
  const scenarios: CompiledScenario[] = []
  for (const [id, s] of Object.entries(data.scenarios ?? {})) {
    const sc = buildScenario(id, s, views, nodes, edges, error, warn)
    if (sc) scenarios.push(sc)
  }

  return {
    name: src.name,
    title: data.title,
    descriptionHtml: data.description ? renderMarkdown(data.description) : undefined,
    nodes,
    groups,
    edges,
    edgeKinds,
    views,
    scenarios,
  }
}

function buildView(
  id: string,
  v: {
    title?: string
    summary?: string
    include?: 'all' | string[]
    exclude?: string[]
    direction?: Direction
    keys?: boolean
    interfaces?: boolean
  },
  diagramTitle: string,
  nodes: Record<string, CompiledNode>,
  groups: Record<string, CompiledGroup>,
  edges: Record<string, CompiledEdge>,
  error: Report,
): CompiledView {
  const known = [...Object.keys(nodes), ...Object.keys(groups)]
  const members = (gid: string, out: Set<string>) => {
    for (const n of Object.values(nodes)) if (n.group === gid) out.add(n.id)
    for (const g of Object.values(groups)) if (g.parent === gid) members(g.id, out)
  }
  const expand = (ids: string[], field: string): Set<string> => {
    const out = new Set<string>()
    ids.forEach((x, i) => {
      if (nodes[x]) out.add(x)
      else if (groups[x]) members(x, out)
      else error(`"${x}" is not a node or group`, ['views', id, field, i], didYouMean(x, known))
    })
    return out
  }

  const include =
    v.include === undefined || v.include === 'all'
      ? new Set(Object.keys(nodes))
      : expand(v.include, 'include')
  for (const x of expand(v.exclude ?? [], 'exclude')) include.delete(x)

  const nodeIds = Object.keys(nodes).filter((n) => include.has(n))
  const groupIds = new Set<string>()
  for (const nid of nodeIds) {
    for (let g = nodes[nid]!.group; g; g = groups[g]?.parent) groupIds.add(g)
  }
  const edgeIds = Object.values(edges)
    .filter((e) => include.has(e.from) && include.has(e.to))
    .map((e) => e.id)

  const keys: Record<string, string> = {}
  if (v.keys) {
    const used = new Set(edgeIds.map((e) => edges[e]!.key).filter((k): k is string => !!k))
    let next = 0
    for (const eid of edgeIds) {
      if (edges[eid]!.hidden) continue
      const explicit = edges[eid]!.key
      if (explicit) keys[eid] = explicit
      else {
        let k = letterKey(next++)
        while (used.has(k)) k = letterKey(next++)
        keys[eid] = k
      }
    }
  } else {
    for (const eid of edgeIds) if (edges[eid]!.key) keys[eid] = edges[eid]!.key!
  }

  return {
    id,
    title: v.title ?? (id === 'main' ? diagramTitle : id),
    summaryHtml: v.summary ? renderMarkdown(v.summary) : undefined,
    direction: v.direction ?? 'AUTO',
    nodeIds,
    groupIds: Object.keys(groups).filter((g) => groupIds.has(g)),
    edgeIds,
    keys,
    interfaces: v.interfaces ?? false,
  }
}

type StepInput = Step

function buildScenario(
  id: string,
  s: NonNullable<RootInput['scenarios']>[string],
  views: CompiledView[],
  nodes: Record<string, CompiledNode>,
  edges: Record<string, CompiledEdge>,
  error: Report,
  warn: Report,
): CompiledScenario | undefined {
  const viewId = s.view ?? views[0]!.id
  const view = views.find((v) => v.id === viewId)
  if (!view) {
    error(
      `Scenario "${id}" uses unknown view "${viewId}"`,
      ['scenarios', id, 'view'],
      didYouMean(
        viewId,
        views.map((v) => v.id),
      ),
    )
    return undefined
  }
  const inView = new Set(view.nodeIds)
  const viewEdges = view.edgeIds.map((e) => edges[e]!)
  const phaseDefs = s.phases ?? [{ title: '', steps: s.steps ?? [] }]

  const phases: CompiledPhase[] = phaseDefs.map((p) => ({
    title: p.title,
    caption: 'caption' in p ? p.caption : undefined,
  }))
  const steps: CompiledStep[] = []
  let parId = 0
  let failed = false

  const checkNode = (nid: string, path: Path): boolean => {
    if (!nodes[nid]) {
      error(`"${nid}" is not a node`, path, didYouMean(nid, Object.keys(nodes)))
      return false
    }
    if (!inView.has(nid)) {
      error(
        `Node "${nid}" is not in view "${view.id}"`,
        path,
        'Add it to the view, or point the scenario at another view.',
      )
      return false
    }
    return true
  }

  const add = (step: StepInput, phase: number, par: number | undefined, path: Path) => {
    const n = steps.length + 1
    const base = {
      id: `s${n}`,
      n,
      phase,
      par,
      title: 'title' in step ? step.title : undefined,
      detail: 'detail' in step ? step.detail : undefined,
      noteHtml: 'note' in step && step.note ? renderMarkdown(step.note) : undefined,
      status: ('status' in step && step.status) || ('built' as Status),
      hold: 'hold' in step ? step.hold : undefined,
    }
    if (step.type === 'self') {
      if (!checkNode(step.at, [...path, 'at'])) {
        failed = true
        return
      }
      const label = step.label ?? step.title
      if (!label) {
        error('A step with `at` needs a `label` or a `title`', path)
        failed = true
        return
      }
      steps.push({
        ...base,
        type: 'self',
        at: step.at,
        label,
        kind: step.kind ?? 'event',
        hops: [],
      })
      return
    }
    if (step.type !== 'flow') return
    const okFrom = checkNode(step.from, [...path, 'from'])
    const okTo = checkNode(step.to, [...path, 'to'])
    const okVia = (step.via ?? []).map((v, i) => checkNode(v, [...path, 'via', i]))
    if (!okFrom || !okTo || okVia.includes(false)) {
      failed = true
      return
    }
    const hops = route([step.from, ...(step.via ?? []), step.to], viewEdges)
    if (!hops) {
      error(
        `No path from "${step.from}" to "${step.to}" in view "${view.id}"`,
        path,
        'Declare an edge between them, or list intermediate nodes with `via:`.',
      )
      failed = true
      return
    }
    const allReverse = hops.length > 0 && hops.every((h) => h.reverse && !edges[h.edge]!.both)
    const kind: StepKind = step.kind ?? (allReverse ? 'response' : 'request')
    steps.push({
      ...base,
      type: 'flow',
      from: step.from,
      to: step.to,
      label: step.label ?? '',
      kind,
      hops,
    })
  }

  phaseDefs.forEach((p, pi) => {
    const base: Path = s.phases
      ? ['scenarios', id, 'phases', pi, 'steps']
      : ['scenarios', id, 'steps']
    p.steps.forEach((step, si) => {
      if (step.type === 'par') {
        parId++
        step.steps.forEach((sub, k) => {
          add(sub, pi, parId, [...base, si, 'steps', k])
        })
      } else add(step, pi, undefined, [...base, si])
    })
  })
  if (failed) return undefined

  const lanes = buildLanes(id, s.lanes, steps, nodes, inView, error, warn)
  if (lanes === null) return undefined

  return {
    id,
    title: s.title,
    summaryHtml: s.summary ? renderMarkdown(s.summary) : undefined,
    mode: s.mode,
    lanes,
    view: view.id,
    phases,
    steps,
  }
}

/** Validate the author's lanes. Returns undefined when none were written, null on error. */
function buildLanes(
  id: string,
  lanes: { title: string; sub?: string; nodes: string[] }[] | undefined,
  steps: CompiledStep[],
  nodes: Record<string, CompiledNode>,
  inView: Set<string>,
  error: Report,
  warn: Report,
): CompiledLane[] | undefined | null {
  if (!lanes?.length) return undefined
  const seen = new Map<string, number>()
  let failed = false
  lanes.forEach((lane, li) => {
    lane.nodes.forEach((nid, ni) => {
      const path: Path = ['scenarios', id, 'lanes', li, 'nodes', ni]
      if (!nodes[nid]) {
        error(`"${nid}" is not a node`, path, didYouMean(nid, Object.keys(nodes)))
        failed = true
      } else if (!inView.has(nid)) {
        error(`Node "${nid}" is not in the scenario's view`, path)
        failed = true
      } else if (seen.has(nid)) {
        error(`Node "${nid}" is already in lane ${(seen.get(nid) ?? 0) + 1}`, path)
        failed = true
      } else seen.set(nid, li)
    })
  })
  if (failed) return null
  const used = new Set(steps.flatMap((s) => [s.from, s.to, s.at]).filter((n): n is string => !!n))
  for (const nid of used) {
    if (!seen.has(nid))
      warn(
        `Node "${nid}" appears in the story but is in no lane; it gets its own lane at the end`,
        ['scenarios', id, 'lanes'],
      )
  }
  return lanes.map((l) => ({ title: l.title, sub: l.sub, nodes: l.nodes }))
}

/** Shortest route over the view's edges. Forward hops are slightly preferred over reverse ones. */
export function route(waypoints: string[], edges: CompiledEdge[]): Hop[] | undefined {
  const all: Hop[] = []
  for (let i = 0; i < waypoints.length - 1; i++) {
    const leg = shortest(waypoints[i]!, waypoints[i + 1]!, edges)
    if (!leg) return undefined
    all.push(...leg)
  }
  return all
}

function shortest(from: string, to: string, edges: CompiledEdge[]): Hop[] | undefined {
  if (from === to) return []
  const adj = new Map<string, { hop: Hop; cost: number }[]>()
  const link = (a: string, b: string, edge: string, reverse: boolean, cost: number) => {
    const list = adj.get(a) ?? []
    list.push({ hop: { edge, reverse, from: a, to: b }, cost })
    adj.set(a, list)
  }
  for (const e of edges) {
    link(e.from, e.to, e.id, false, 1)
    link(e.to, e.from, e.id, true, e.both ? 1 : 1.05)
  }
  const best = new Map<string, number>([[from, 0]])
  const prev = new Map<string, Hop>()
  const queue: [string, number][] = [[from, 0]]
  while (queue.length) {
    queue.sort((a, b) => a[1] - b[1])
    const [cur, cost] = queue.shift()!
    if (cur === to) break
    if (cost > (best.get(cur) ?? Infinity)) continue
    for (const { hop, cost: c } of adj.get(cur) ?? []) {
      const next = cost + c
      if (next < (best.get(hop.to) ?? Infinity)) {
        best.set(hop.to, next)
        prev.set(hop.to, hop)
        queue.push([hop.to, next])
      }
    }
  }
  if (!prev.has(to)) return undefined
  const hops: Hop[] = []
  for (let cur = to; cur !== from; ) {
    const hop = prev.get(cur)!
    hops.unshift(hop)
    cur = hop.from
  }
  return hops
}

function parse(file: string, text: string, diagnostics: Diagnostic[]): Source | undefined {
  const lines = new LineCounter()
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false })
  for (const e of doc.errors) {
    const p = e.pos[0] === undefined ? undefined : lines.linePos(e.pos[0])
    diagnostics.push({
      severity: 'error',
      message: e.message.split('\n')[0] ?? e.message,
      file,
      line: p?.line,
      col: p?.col,
    })
  }
  if (doc.errors.length) return undefined
  return { file, doc, lines }
}

/**
 * The document as plain data. The parser accepts a document that `toJS` then refuses (an alias
 * whose anchor does not exist yet), and a half-typed file in an editor is exactly that.
 */
function toJS(
  source: Source,
  diagnostics: Diagnostic[],
  options?: { maxAliasCount: number },
): unknown {
  try {
    return source.doc.toJS(options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    diagnostics.push({
      severity: 'error',
      message: message.split('\n')[0] ?? message,
      file: source.file,
    })
    return undefined
  }
}

/** Walk the YAML tree as far as the path goes and report where it stops. */
function locate(source: Source, path: Path): { line?: number; col?: number } {
  let node = source.doc.contents as Node | null
  let at: Node | null = node
  for (const seg of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => (p.key as { value?: unknown } | null)?.value === seg)
      if (!pair) break
      at = (pair.key as Node | null) ?? at
      node = pair.value as Node | null
    } else if (isSeq(node) && typeof seg === 'number') {
      const item = node.items[seg] as Node | undefined
      if (!item) break
      node = item
      at = item
    } else break
  }
  const offset = at?.range?.[0]
  if (offset === undefined) return {}
  const p = source.lines.linePos(offset)
  return { line: p.line, col: p.col }
}

interface ZodIssueLike {
  code: string
  path: PropertyKey[]
  message: string
  keys?: string[]
}

function describeIssue(issue: ZodIssueLike): { message: string; hint?: string } {
  if (issue.code === 'unrecognized_keys') {
    const keys = issue.keys ?? []
    const allowed = allowedKeysFor(issue.path)
    const hint = allowed
      ? (keys.map((k) => didYouMean(k, allowed)).find(Boolean) ?? `Allowed: ${allowed.join(', ')}`)
      : undefined
    return {
      message: `Unknown ${keys.length > 1 ? 'keys' : 'key'} ${keys.map((k) => `"${k}"`).join(', ')}`,
      hint,
    }
  }
  const p = issue.path
  if (
    p[0] === 'scenarios' &&
    p.includes('steps') &&
    (issue.code === 'invalid_union' || issue.path.at(-1) === 'type')
  ) {
    return {
      message: 'Not a recognised step',
      hint: 'Use `a -> b: label`, `at node: label`, or `par:` with a list of steps.',
    }
  }
  return { message: issue.message }
}

function allowedKeysFor(path: PropertyKey[]): readonly string[] | undefined {
  const [section] = path
  if (path.length === 0) return KNOWN_KEYS.root
  if (path.length !== 2) return undefined
  switch (section) {
    case 'nodes':
      return KNOWN_KEYS.node
    case 'groups':
      return KNOWN_KEYS.group
    case 'edges':
      return KNOWN_KEYS.edge
    case 'views':
      return KNOWN_KEYS.view
    case 'scenarios':
      return KNOWN_KEYS.scenario
    default:
      return undefined
  }
}
