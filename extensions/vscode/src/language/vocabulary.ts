// What can be written where in a diagram file: the keys of each kind of mapping, and the values
// some keys take. Everything but steps is read from the same JSON Schema `idocs schema` writes,
// so a new key in the format shows up in completion without touching this file.
import { BUILTIN_EDGE_KINDS, BUILTIN_KINDS } from '@the-package-labs/idocs-core'
import { authoringJsonSchema } from '@the-package-labs/idocs-core/browser'

export type Context =
  | 'root'
  | 'defaults'
  | 'node'
  | 'chip'
  | 'link'
  | 'group'
  | 'edge'
  | 'view'
  | 'scenario'
  | 'phase'
  | 'lane'
  | 'step'
  | 'kind'
  | 'edgeKind'

export interface Prop {
  name: string
  description?: string
  /** Fixed choices, when the schema lists them. */
  values?: string[]
  boolean?: boolean
}

/** A JSON Schema fragment. The schema is built by the compiler, so its shape is trusted here. */
interface Json {
  type?: string
  description?: string
  enum?: string[]
  properties?: Record<string, Json>
  additionalProperties?: Json
  items?: Json
  anyOf?: Json[]
}

const STEP_KINDS = ['request', 'response', 'error', 'lookup', 'event']
const STATUSES = ['built', 'planned', 'legacy', 'optional']

/** Steps are open in the schema (three shorthand forms), so their keys are listed here. A test
 * compares this list with the schema the compiler validates against. */
export const STEP_PROPS: Prop[] = [
  { name: 'from', description: 'Node the packet leaves.' },
  { name: 'to', description: 'Node the packet arrives at.' },
  { name: 'at', description: 'Node a self step happens in.' },
  { name: 'label', description: 'What travels, or the caption of a self step.' },
  { name: 'via', description: 'Force the route through these nodes.' },
  { name: 'title', description: 'Heading of the step in the story view. Defaults to the label.' },
  {
    name: 'detail',
    description:
      'One to three short lines under the heading in the story view. Defaults to "from → to".',
  },
  { name: 'kind', values: STEP_KINDS },
  { name: 'note', description: 'Markdown explanation shown with the step.' },
  { name: 'status', values: STATUSES },
  { name: 'hold', description: 'Extra pause in seconds.' },
]

let cache: Map<Context, Prop[]> | undefined

function propsOf(object: Json | undefined): Prop[] {
  return Object.entries(object?.properties ?? {}).map(([name, s]) => {
    const prop: Prop = { name }
    if (s.description) prop.description = s.description
    if (s.enum) prop.values = s.enum
    if (s.type === 'boolean') prop.boolean = true
    return prop
  })
}

/** The object branch of a schema that also accepts a string (`api: API server`). */
function objectBranch(s: Json | undefined): Json | undefined {
  if (!s) return undefined
  if (s.properties) return s
  return s.anyOf?.find((b) => b.type === 'object' && b.properties)
}

function table(): Map<Context, Prop[]> {
  if (cache) return cache
  const root = authoringJsonSchema() as Json
  const p = root.properties ?? {}
  const scenario = p.scenarios?.additionalProperties
  const node = objectBranch(p.nodes?.additionalProperties)

  cache = new Map<Context, Prop[]>([
    ['root', propsOf(root)],
    ['defaults', propsOf(p.defaults)],
    ['node', propsOf(node)],
    ['chip', propsOf(objectBranch(node?.properties?.chips?.items))],
    ['link', propsOf(node?.properties?.links?.items)],
    ['group', propsOf(objectBranch(p.groups?.additionalProperties))],
    ['edge', propsOf(objectBranch(p.edges?.items))],
    ['view', propsOf(p.views?.additionalProperties)],
    ['scenario', propsOf(scenario)],
    ['phase', propsOf(scenario?.properties?.phases?.items)],
    ['lane', propsOf(scenario?.properties?.lanes?.items)],
    ['step', STEP_PROPS],
    ['kind', propsOf(p.kinds?.additionalProperties)],
    ['edgeKind', propsOf(p.edgeKinds?.additionalProperties)],
  ])
  return cache
}

export function propsFor(context: Context): Prop[] {
  return table().get(context) ?? []
}

export function propOf(context: Context, name: string): Prop | undefined {
  return propsFor(context).find((p) => p.name === name)
}

/** The kinds a node can have: the built-in ones, then the ones the diagram defines. */
export function nodeKinds(custom: string[] = []): string[] {
  return [...new Set([...Object.keys(BUILTIN_KINDS), ...custom])]
}

export function edgeKinds(custom: string[] = []): string[] {
  return [...new Set([...Object.keys(BUILTIN_EDGE_KINDS), ...custom])]
}

export const stepKinds = STEP_KINDS
export const statuses = STATUSES
