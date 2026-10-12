// Compiled, JSON-serialisable shapes. Everything the renderer needs, nothing it has to parse.

export type Status = 'built' | 'planned' | 'legacy' | 'optional'
export type Family = 'blue' | 'amber' | 'violet' | 'green' | 'teal' | 'red' | 'slate'
export type StepKind = 'request' | 'response' | 'error' | 'lookup' | 'event'
export type Direction = 'AUTO' | 'RIGHT' | 'DOWN' | 'LEFT' | 'UP'
export type GroupLayout = 'flow' | 'row' | 'grid' | 'rows'

export interface IconData {
  body: string
  viewBox: string
  /** Monochrome icons are tinted with currentColor; brand logos keep their own colours. */
  mono: boolean
  set: string
  name: string
}

export interface Chip {
  label: string
  sub?: string
}

export interface NodeLink {
  label: string
  url: string
}

/** Another diagram that shows the inside of a node. Resolved by name against the project's diagrams. */
export interface NodeDiagram {
  name: string
  view?: string
  scenario?: string
}

export interface CompiledNode {
  id: string
  title: string
  sub?: string
  lines: string[]
  icon?: IconData
  kind?: string
  family?: Family
  group?: string
  status: Status
  badge?: string
  uses: string[]
  chips: Chip[]
  w?: number
  docHtml?: string
  links: NodeLink[]
  refs: string[]
  tags: string[]
  /** Opens one level deeper: the diagram that describes this node's inside. */
  diagram?: NodeDiagram
}

export interface CompiledGroup {
  id: string
  label: string
  caption?: string
  parent?: string
  layout: GroupLayout
  rows?: string[][]
  columns?: number
  direction?: 'AUTO' | 'RIGHT' | 'DOWN'
  family?: Family
  status: Status
  /** Top-level groups are filled zones, nested ones are dashed frames. */
  style: 'zone' | 'frame'
  icon?: IconData
}

export interface EdgeKindDef {
  label: string
  /** A token name (ink, accent, tunnel, muted, ok, warn, bad) or any CSS colour. */
  color: string
  width: number
  dash?: string
}

export interface CompiledEdge {
  id: string
  from: string
  to: string
  label?: string
  kind: string
  both: boolean
  hidden: boolean
  status: Status
  key?: string
  auth?: string
  payload?: string
  transport?: string
  noteHtml?: string
}

export interface CompiledView {
  id: string
  title: string
  summaryHtml?: string
  direction: Direction
  nodeIds: string[]
  groupIds: string[]
  edgeIds: string[]
  /** Letter keys for edges (A, B, ...) when the view asks for them. */
  keys: Record<string, string>
  interfaces: boolean
}

export interface Hop {
  edge: string
  /** True when the packet travels against the edge's declared direction. */
  reverse: boolean
  /** Node the packet leaves and the node it arrives at. */
  from: string
  to: string
}

export interface CompiledStep {
  id: string
  /** Display number, 1-based, in authoring order. */
  n: number
  phase: number
  /** Steps sharing a par id start together. */
  par?: number
  type: 'flow' | 'self'
  from?: string
  to?: string
  at?: string
  label: string
  title?: string
  detail?: string
  kind: StepKind
  noteHtml?: string
  status: Status
  hops: Hop[]
  hold?: number
}

export interface CompiledPhase {
  title: string
  caption?: string
}

export interface CompiledLane {
  title: string
  sub?: string
  nodes: string[]
}

export type ScenarioMode = 'flow' | 'sequence' | 'story'

export interface CompiledScenario {
  id: string
  title: string
  summaryHtml?: string
  mode?: ScenarioMode
  lanes?: CompiledLane[]
  view: string
  phases: CompiledPhase[]
  steps: CompiledStep[]
}

export interface CompiledDiagram {
  name: string
  title: string
  descriptionHtml?: string
  nodes: Record<string, CompiledNode>
  groups: Record<string, CompiledGroup>
  edges: Record<string, CompiledEdge>
  edgeKinds: Record<string, EdgeKindDef>
  views: CompiledView[]
  scenarios: CompiledScenario[]
  /**
   * The diagrams its nodes open, by name, and the ones those open in turn. Added once every
   * diagram of the project has compiled (`attachNested`), so a diagram is all a viewer needs. The
   * entries themselves carry no `nested`.
   */
  nested?: Record<string, CompiledDiagram>
}

export interface Pt {
  x: number
  y: number
}

export interface Rect extends Pt {
  w: number
  h: number
}

export interface EdgeLayout {
  points: Pt[]
  length: number
  label?: Rect
  key?: Pt
}

export interface Layout {
  width: number
  height: number
  nodes: Record<string, Rect>
  groups: Record<string, Rect>
  edges: Record<string, EdgeLayout>
}
