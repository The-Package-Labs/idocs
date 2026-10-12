// Every place a diagram mentions a node, group or view by id. Walking the YAML tree (instead of
// searching for words) tells `api` the node from `api` inside a label, and it understands the
// shorthand: `- a -> b: label`, `- at a: label`, `- par: [...]`.

import type { Scalar, YAMLMap } from 'yaml'
import { isScalar } from 'yaml'
import type { Declaration } from './declarations'
import {
  getPair,
  isMapNode,
  isSeqNode,
  keyText,
  type Parsed,
  type Pos,
  type Span,
  text,
} from './yaml'

/** `member` is a node or a group, `group` only a group, `view` a view. */
export type RefKind = 'member' | 'group' | 'view'

export interface Reference {
  id: string
  kind: RefKind
  span: Span
}

/** `diagram.yaml` holds the whole model; a scenario file holds one scenario at its root. */
export type FileKind = 'diagram' | 'scenario'

// The same shapes core/normalize.ts accepts. `d` gives the position of each capture.
const EDGE_ARROW = /^(\S+?)\s*(<->|->)\s*(\S+?)(?:\s*:\s+(.*))?$/d
const STEP_ARROW = /^(\S+?)\s*->\s*(\S+)$/d
const SELF_STEP = /^at\s+(\S+)$/d

export function referencesIn(parsed: Parsed, file: FileKind): Reference[] {
  const out: Reference[] = []
  const root = parsed.root
  if (!root) return out
  const w = new Walker(parsed, out)
  if (file === 'scenario') w.scenario(root)
  else w.diagram(root)
  return out
}

class Walker {
  constructor(
    private parsed: Parsed,
    private out: Reference[],
  ) {}

  private ref(node: unknown, kind: RefKind) {
    const id = text(node)
    const span = this.parsed.span(node as Scalar)
    if (id && span && isScalar(node) && typeof node.value === 'string') {
      this.out.push({ id, kind, span })
    }
  }

  private refs(node: unknown, kind: RefKind) {
    if (isSeqNode(node)) for (const item of node.items) this.ref(item, kind)
  }

  /** Both ends of `a -> b` written in a scalar (a string item or a compact key). */
  private arrow(node: unknown, pattern: RegExp, ends: [number, number]) {
    if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return
    const m = pattern.exec(node.value)
    if (!m?.indices) return
    const quoted = node.type === 'QUOTE_DOUBLE' || node.type === 'QUOTE_SINGLE'
    const base = node.range[0] + (quoted ? 1 : 0)
    for (const group of ends) {
      const at = m.indices[group]
      const id = m[group]
      if (!at || !id) continue
      this.out.push({
        id,
        kind: 'member',
        span: { start: this.parsed.pos(base + at[0]), end: this.parsed.pos(base + at[1]) },
      })
    }
  }

  diagram(root: YAMLMap) {
    this.ref(getPair(asMap(getPair(root, 'defaults')?.value), 'view')?.value, 'view')
    for (const pair of this.pairs(getPair(root, 'nodes')?.value)) {
      this.ref(getPair(asMap(pair.value), 'in')?.value, 'group')
    }
    for (const pair of this.pairs(getPair(root, 'groups')?.value)) {
      const group = asMap(pair.value)
      this.ref(getPair(group, 'in')?.value, 'group')
      const rows = getPair(group, 'rows')?.value
      if (isSeqNode(rows)) for (const row of rows.items) this.refs(row, 'member')
    }
    const edges = getPair(root, 'edges')?.value
    if (isSeqNode(edges)) for (const item of edges.items) this.edge(item)

    for (const pair of this.pairs(getPair(root, 'views')?.value)) {
      const view = asMap(pair.value)
      const include = getPair(view, 'include')?.value
      if (isSeqNode(include)) this.refs(include, 'member')
      this.refs(getPair(view, 'exclude')?.value, 'member')
    }
    for (const pair of this.pairs(getPair(root, 'scenarios')?.value)) {
      const scenario = asMap(pair.value)
      if (scenario) this.scenario(scenario)
    }
  }

  scenario(scenario: YAMLMap) {
    this.ref(getPair(scenario, 'view')?.value, 'view')
    const lanes = getPair(scenario, 'lanes')?.value
    if (isSeqNode(lanes)) {
      for (const lane of lanes.items) this.refs(getPair(asMap(lane), 'nodes')?.value, 'member')
    }
    this.steps(getPair(scenario, 'steps')?.value)
    const phases = getPair(scenario, 'phases')?.value
    if (isSeqNode(phases)) {
      for (const phase of phases.items) this.steps(getPair(asMap(phase), 'steps')?.value)
    }
  }

  private edge(item: unknown) {
    if (isScalar(item)) return this.arrow(item, EDGE_ARROW, [1, 3])
    const map = asMap(item)
    if (!map) return
    if (getPair(map, 'from') || getPair(map, 'to')) {
      this.ref(getPair(map, 'from')?.value, 'member')
      this.ref(getPair(map, 'to')?.value, 'member')
      return
    }
    // `- a -> b: { ... }`: the arrow is the key.
    for (const pair of map.items) this.arrow(pair.key, EDGE_ARROW, [1, 3])
  }

  private steps(node: unknown) {
    if (isSeqNode(node)) for (const item of node.items) this.step(item)
  }

  private step(item: unknown) {
    if (isScalar(item)) return this.arrow(item, STEP_ARROW, [1, 2])
    const map = asMap(item)
    if (map) this.stepMap(map)
  }

  /** A step as a mapping, or the properties after a compact key (`a -> b: { via: [x] }`). */
  private stepMap(map: YAMLMap) {
    for (const pair of map.items) {
      const key = keyText(pair)
      if (key === 'from' || key === 'to' || key === 'at') this.ref(pair.value, 'member')
      else if (key === 'via') this.refs(pair.value, 'member')
      else if (key === 'steps' || key === 'par') this.steps(pair.value)
      else if (key !== undefined) {
        this.arrow(pair.key, STEP_ARROW, [1, 2])
        const self = SELF_STEP.exec(key)
        if (self?.indices?.[1] && isScalar(pair.key) && pair.key.range) {
          const quoted = pair.key.type === 'QUOTE_DOUBLE' || pair.key.type === 'QUOTE_SINGLE'
          const base = pair.key.range[0] + (quoted ? 1 : 0)
          this.out.push({
            id: self[1] ?? '',
            kind: 'member',
            span: {
              start: this.parsed.pos(base + self.indices[1][0]),
              end: this.parsed.pos(base + self.indices[1][1]),
            },
          })
        }
        const props = asMap(pair.value)
        if (props) this.stepMap(props)
      }
    }
  }

  private pairs(node: unknown) {
    return isMapNode(node) ? node.items : []
  }
}

function asMap(node: unknown): YAMLMap | undefined {
  return isMapNode(node) ? node : undefined
}

// -- Lookups ------------------------------------------------------------------------------------

/** A node, group or view an editor position refers to. */
export interface SymbolRef {
  id: string
  /** Nodes and groups share one namespace; views have their own. */
  namespace: 'member' | 'view'
  span: Span
}

const MEMBER_SECTIONS = ['nodes', 'groups']

export function contains(span: Span, pos: Pos): boolean {
  const afterStart =
    pos.line > span.start.line ||
    (pos.line === span.start.line && pos.character >= span.start.character)
  const beforeEnd =
    pos.line < span.end.line || (pos.line === span.end.line && pos.character <= span.end.character)
  return afterStart && beforeEnd
}

export function namespaceOf(kind: RefKind): SymbolRef['namespace'] {
  return kind === 'view' ? 'view' : 'member'
}

/** The symbol under `pos`: a use of an id, or the key that declares it. */
export function symbolAt(
  pos: Pos,
  refs: Reference[],
  declarations: Declaration[],
): SymbolRef | undefined {
  const ref = refs.find((r) => contains(r.span, pos))
  if (ref) return { id: ref.id, namespace: namespaceOf(ref.kind), span: ref.span }
  const declared = declarations.find((d) => contains(d.key, pos))
  if (declared && (MEMBER_SECTIONS.includes(declared.section) || declared.section === 'views')) {
    return {
      id: declared.id,
      namespace: declared.section === 'views' ? 'view' : 'member',
      span: declared.key,
    }
  }
  return undefined
}

export function declarationOf(symbol: SymbolRef, declarations: Declaration[]) {
  return declarations.find(
    (d) =>
      d.id === symbol.id &&
      (symbol.namespace === 'view' ? d.section === 'views' : MEMBER_SECTIONS.includes(d.section)),
  )
}

export function isUseOf(ref: Reference, symbol: SymbolRef): boolean {
  return ref.id === symbol.id && namespaceOf(ref.kind) === symbol.namespace
}
