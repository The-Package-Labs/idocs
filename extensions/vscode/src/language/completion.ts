// Completion items for a position in a diagram file. Pure: the model (ids declared in the folder),
// the icon catalog and the text come in, items come out. The VS Code adapter only converts them.
import type { Pos } from '../model/yaml'
import { type Cursor, contextOf, cursorContext, isCompact, listKind } from './context'
import {
  edgeKinds,
  nodeKinds,
  type Prop,
  propOf,
  propsFor,
  statuses,
  stepKinds,
} from './vocabulary'

export type SuggestionKind =
  | 'property'
  | 'value'
  | 'node'
  | 'group'
  | 'view'
  | 'diagram'
  | 'icon'
  | 'keyword'
  | 'file'

export interface Suggestion {
  label: string
  kind: SuggestionKind
  /** What the editor matches typed text against, when that is not the label. */
  filterText?: string
  detail?: string
  documentation?: string
  /** Inserted instead of the label. */
  insertText?: string
  /** Ask the editor to complete again right after inserting (`a -> ` wants a target). */
  retrigger?: boolean
}

export interface Entity {
  id: string
  /** Shown beside the id: the title, or the label of a group. */
  detail?: string
}

/** What the diagram folder declares, wherever it is written. */
export interface ProjectIds {
  nodes: Entity[]
  groups: Entity[]
  views: Entity[]
  customKinds: string[]
  customEdgeKinds: string[]
  /** Markdown files in `nodes/`, relative to the diagram folder. */
  docs: string[]
  /** The other diagrams of the project, which a node can open. */
  diagrams: Entity[]
}

export interface IconCatalog {
  search(query: string, limit?: number): string[]
  /** The icon a bare name resolves to, as `set:name`. */
  resolve(spec: string): string | undefined
}

export interface CompletionRequest {
  text: string
  position: Pos
  file: 'diagram' | 'scenario'
  ids: ProjectIds
  icons: IconCatalog
}

export interface Completion {
  /** The part of the line the items replace. */
  range: { line: number; start: number; end: number }
  items: Suggestion[]
}

const ARROW_CONTEXTS = new Set(['edges', 'steps'])

export function complete(req: CompletionRequest): Completion | undefined {
  const cursor = cursorContext(req.text, req.position)
  if (cursor.none) return undefined

  const items = suggest(cursor, req)
  if (!items.length) return undefined

  const line = req.text.split('\n')[req.position.line] ?? ''
  // Replace the rest of the word under the cursor too, so completing mid-word does not duplicate.
  let end = req.position.character
  while (end < line.length && /[\w.:/-]/.test(line[end] ?? '')) end++

  // Completing straight after `kind:` (the colon is a trigger) must not produce `kind:service`.
  const afterColon = cursor.where === 'value' && line[cursor.start - 1] === ':'
  const out = afterColon
    ? items.map((i) => ({ ...i, insertText: ` ${i.insertText ?? i.label}`, filterText: i.label }))
    : items
  return { range: { line: req.position.line, start: cursor.start, end }, items: out }
}

function suggest(cursor: Cursor, req: CompletionRequest): Suggestion[] {
  const context = contextOf(cursor.path, req.file)
  const list = listKind(cursor.path, req.file)

  switch (cursor.where) {
    case 'arrow-target':
      // An edge or a step joins nodes; a group is not a place a request can go.
      return nodes(req.ids).filter((n) => n.label !== cursor.source)
    case 'item': {
      const out: Suggestion[] = []
      if (list && ARROW_CONTEXTS.has(list)) {
        out.push(
          ...nodes(req.ids).map((s) => ({ ...s, insertText: `${s.label} -> `, retrigger: true })),
        )
        if (list === 'steps') out.push(...stepStarters())
      }
      if (context) out.push(...keys(context, cursor, false))
      return out
    }
    case 'key':
      if (!context) return []
      return keys(context, cursor, isCompact(cursor.path))
    case 'value':
      return values(context, cursor, req)
  }
}

function keys(
  context: NonNullable<ReturnType<typeof contextOf>>,
  cursor: Cursor,
  compact: boolean,
): Suggestion[] {
  const skip = new Set(cursor.siblings)
  return propsFor(context)
    .filter((p) => !skip.has(p.name) && !(compact && (p.name === 'from' || p.name === 'to')))
    .map((p) => ({
      label: p.name,
      kind: 'property' as const,
      documentation: p.description,
      insertText: `${p.name}: `,
      retrigger: true,
    }))
}

function values(
  context: ReturnType<typeof contextOf>,
  cursor: Cursor,
  req: CompletionRequest,
): Suggestion[] {
  const key = cursor.key
  // A key means something only inside the mapping that defines it: a node that happens to be
  // called `status` or `view`, or a `kind:` inside a list of strings, gets no suggestions.
  if (!key || !context) return []
  const { ids } = req
  const prop = propOf(context, key)
  if (!prop) return []

  switch (key) {
    case 'kind':
      if (context === 'edge') return words(edgeKinds(ids.customEdgeKinds), 'edge kind')
      if (context === 'step') return words(stepKinds, 'step kind')
      return words(nodeKinds(ids.customKinds), 'node kind')
    case 'in':
      return groups(ids)
    case 'from':
    case 'to':
    case 'at':
    case 'via':
    case 'nodes':
      return nodes(ids)
    case 'include':
      return [{ label: 'all', kind: 'keyword' }, ...members(ids)]
    case 'exclude':
      return members(ids)
    case 'view':
      return ids.views.map((v) => ({ label: v.id, kind: 'view', detail: v.detail }))
    case 'icon':
      return icons(cursor.typed, req.icons)
    case 'doc':
      return ids.docs.map((d) => ({ label: d, kind: 'file' }))
    case 'diagram':
      return ids.diagrams.map((d) => ({ label: d.id, kind: 'diagram', detail: d.detail }))
    case 'status':
      return words(prop?.values ?? statuses, 'status')
  }
  if (prop?.values) return words(prop.values, key)
  if (prop?.boolean) return words(['true', 'false'], 'boolean')
  return []
}

const words = (list: readonly string[], detail: string): Suggestion[] =>
  list.map((label) => ({ label, kind: 'value', detail }))

const nodes = (ids: ProjectIds): Suggestion[] =>
  ids.nodes.map((n) => ({ label: n.id, kind: 'node', detail: n.detail }))

const groups = (ids: ProjectIds): Suggestion[] =>
  ids.groups.map((g) => ({ label: g.id, kind: 'group', detail: g.detail }))

/** Nodes and groups; `except` leaves out the node already chosen on the other side of an arrow. */
const members = (ids: ProjectIds, except?: string): Suggestion[] => [
  ...nodes(ids).filter((n) => n.label !== except),
  ...groups(ids),
]

function stepStarters(): Suggestion[] {
  return [
    {
      label: 'at',
      kind: 'keyword',
      detail: 'self step',
      documentation: 'Something happens inside one node: `at api: validate the token`.',
      insertText: 'at ',
      retrigger: true,
    },
    {
      label: 'par',
      kind: 'keyword',
      detail: 'parallel steps',
      documentation: 'Steps that start together.',
      insertText: 'par:',
    },
  ]
}

const POPULAR_SETS = ['lucide:', 'logos:', 'simple-icons:']

function icons(typed: string, catalog: IconCatalog): Suggestion[] {
  if (!typed) {
    return POPULAR_SETS.map((set) => ({
      label: set,
      kind: 'keyword' as const,
      detail: 'icon set',
      retrigger: true,
    }))
  }
  // `lucide:` alone lists nothing to search for, so search the part after the colon.
  const query = typed.includes(':') ? typed.slice(typed.indexOf(':') + 1) : typed
  const prefix = typed.includes(':') ? typed.slice(0, typed.indexOf(':') + 1) : ''
  if (!query) return []
  return catalog
    .search(query, 40)
    .filter((id) => id.startsWith(prefix))
    .map((id) => {
      const name = id.slice(id.indexOf(':') + 1)
      // The short form is what the docs show; use it when it means the same icon.
      const short = !prefix && catalog.resolve(name) === id ? name : id
      return { label: short, kind: 'icon' as const, detail: id }
    })
}

export type { Prop }
