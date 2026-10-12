// What the cursor is in, worked out from the text around it. This is line based on purpose: while
// someone is typing, the document rarely parses (`from: ` has no value yet), so the structure is
// recovered from indentation the way a person reads it.
import type { Pos } from '../model/yaml'
import type { Context } from './vocabulary'

export type Where =
  /** Typing a key, or the start of a list item that could be a key. */
  | 'key'
  /** After `key:`. */
  | 'value'
  /** After `- ` where an `a -> b` shorthand may start. */
  | 'item'
  /** After the arrow of `a -> b`. */
  | 'arrow-target'

export interface Cursor {
  where: Where
  /** Keys leading to the mapping or sequence the cursor is in; `-` stands for a sequence item. */
  path: string[]
  /** The key whose value is being typed. */
  key?: string
  /** Text of the token typed so far, quotes removed. */
  typed: string
  /** Column the token starts at. */
  start: number
  /** Keys already written in the same mapping. */
  siblings: string[]
  /** For `arrow-target`: the node before the arrow. */
  source?: string
  /** The cursor is in a place that never completes: a comment, a block scalar, a quoted key. */
  none?: boolean
  inFlow?: boolean
}

interface LineInfo {
  indent: number
  /** Columns of the `-` markers. */
  dashes: number[]
  /** Column where the content after the markers starts. */
  contentCol: number
  key?: string
  hasValue: boolean
  /** `|` or `>` follows the key: the lines below are text. */
  blockScalar: boolean
}

const KEY = /^("[^"]*"|'[^']*'|[^\s#"'[\]{},&*!|>%@`][^#]*?)\s*:(?=\s|$)/

export function parseLine(line: string): LineInfo | undefined {
  if (/^\s*(#.*)?$/.test(line)) return undefined
  const indent = line.length - line.trimStart().length
  const dashes: number[] = []
  let col = indent
  while (line[col] === '-' && (line[col + 1] === ' ' || line[col + 1] === undefined)) {
    dashes.push(col)
    col++
    while (line[col] === ' ') col++
  }
  const rest = line.slice(col)
  const key = KEY.exec(rest)
  const after = key ? stripComment(rest.slice(key[0].length)).trim() : stripComment(rest).trim()
  return {
    indent,
    dashes,
    contentCol: col,
    key: key ? unquote(key[1] ?? '') : undefined,
    hasValue: key ? after !== '' : after !== '',
    blockScalar: !!key && /^[|>][-+0-9]*$/.test(after),
  }
}

function unquote(s: string): string {
  return /^(["']).*\1$/.test(s) ? s.slice(1, -1) : s
}

/** Removes a trailing `# comment` that is not inside quotes. */
export function stripComment(s: string): string {
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1] ?? ''))) return s.slice(0, i)
  }
  return s
}

function inComment(before: string): boolean {
  return stripComment(before).length < before.length
}

/** The innermost `{` or `[` still open at the end of `before`, outside quotes. */
function openFlow(before: string): { char: '{' | '['; index: number } | undefined {
  const stack: { char: '{' | '['; index: number }[] = []
  let quote = ''
  for (let i = 0; i < before.length; i++) {
    const c = before[i]
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '{' || c === '[') stack.push({ char: c, index: i })
    else if (c === '}' || c === ']') stack.pop()
  }
  return stack[stack.length - 1]
}

export function cursorContext(text: string, pos: Pos): Cursor {
  const lines = text.split('\n')
  const line = lines[pos.line] ?? ''
  const before = line.slice(0, pos.character)

  const none: Cursor = {
    where: 'key',
    path: [],
    typed: '',
    start: pos.character,
    siblings: [],
    none: true,
  }
  if (inComment(before)) return none

  const info = parseLine(before) ?? {
    indent: before.length - before.trimStart().length,
    dashes: [],
    contentCol: before.length,
    hasValue: false,
    blockScalar: false,
  }

  const { path, insideScalar, siblings } = ancestors(lines, pos.line, info)
  if (insideScalar) return none

  for (const _ of info.dashes) path.push('-')

  const flow = openFlow(before)
  if (flow) return inFlow(before, flow, path, siblings, pos)

  const rest = before.slice(info.contentCol)
  const key = KEY.exec(rest)
  if (key) {
    const value = rest.slice(key[0].length)
    const lead = value.length - value.trimStart().length
    const raw = value.trimStart()
    const quoted = /^["']/.test(raw)
    return {
      where: 'value',
      path,
      key: unquote(key[1] ?? ''),
      typed: quoted ? raw.slice(1) : raw,
      start: info.contentCol + key[0].length + lead + (quoted ? 1 : 0),
      siblings,
    }
  }

  const arrow = /^(\S+?)\s*(?:<->|->)\s*(\S*)$/.exec(rest)
  if (arrow && info.dashes.length) {
    return {
      where: 'arrow-target',
      path,
      typed: arrow[2] ?? '',
      start: before.length - (arrow[2]?.length ?? 0),
      siblings,
      source: arrow[1],
    }
  }

  const word = /[^\s]*$/.exec(rest)?.[0] ?? ''
  return {
    where: info.dashes.length ? 'item' : 'key',
    path,
    typed: word,
    start: before.length - word.length,
    siblings,
  }
}

/**
 * The key whose value is the flow collection that opens right after `prefix`: `via` in
 * `via: [`, and the whole `web -> api` in `- web -> api: {`.
 */
function ownerKey(prefix: string): string | undefined {
  const m = /([^,{}[\]]+?)\s*:\s*$/.exec(prefix.replace(/^\s*(?:-\s+)+/, ''))
  const key = m?.[1]?.trim()
  return key ? unquote(key) : undefined
}

/** `{ kind: da|` and `[a, b|`. */
function inFlow(
  before: string,
  flow: { char: '{' | '['; index: number },
  base: string[],
  siblings: string[],
  pos: Pos,
): Cursor {
  const inner = before.slice(flow.index + 1)
  const segmentStart = Math.max(inner.lastIndexOf(','), -1) + 1
  const segment = inner.slice(segmentStart)
  const offset = flow.index + 1 + segmentStart

  if (flow.char === '[') {
    // The key that owns the list: `via: [a, |`.
    const owner = ownerKey(before.slice(0, flow.index))
    const word = /[^\s]*$/.exec(segment)?.[0] ?? ''
    return {
      where: 'value',
      path: base,
      key: owner,
      typed: word,
      start: pos.character - word.length,
      siblings,
      inFlow: true,
    }
  }

  const m = KEY.exec(segment.trimStart())
  if (m) {
    const lead = segment.length - segment.trimStart().length
    const value = segment.trimStart().slice(m[0].length)
    const raw = value.trimStart()
    const quoted = /^["']/.test(raw)
    const owner = ownerKey(before.slice(0, flow.index))
    return {
      where: 'value',
      path: [...base, ...(owner ? [owner] : [])],
      key: unquote(m[1] ?? ''),
      typed: quoted ? raw.slice(1) : raw,
      start: offset + lead + m[0].length + (value.length - raw.length) + (quoted ? 1 : 0),
      siblings,
      inFlow: true,
    }
  }
  const word = segment.trimStart()
  const owner = ownerKey(before.slice(0, flow.index))
  return {
    where: 'key',
    path: [...base, ...(owner ? [owner] : [])],
    typed: word,
    start: pos.character - word.length,
    siblings: [],
    inFlow: true,
  }
}

interface Ancestry {
  path: string[]
  insideScalar: boolean
  siblings: string[]
}

/**
 * Walks up from the cursor's line collecting the keys and list items it is nested in, and the
 * keys already written beside the cursor.
 */
function ancestors(lines: string[], lineNo: number, current: LineInfo): Ancestry {
  const path: string[] = []
  const siblings: string[] = []
  // The column of the first thing on the line: ancestors sit to its left.
  let limit = current.dashes[0] ?? current.contentCol
  const mapCol = current.contentCol
  // A list may start at the same column as the key that owns it:  `edges:` / `- a -> b`.
  let allowEqual = current.dashes.length > 0
  let first = true

  for (let i = lineNo - 1; i >= 0; i--) {
    const info = parseLine(lines[i] ?? '')
    if (!info) continue

    // Sibling keys: same column as ours, before any ancestor is found. A line that opens a new
    // list item still counts (its key is ours); the item marker then ends the search.
    if (
      path.length === 0 &&
      info.contentCol === mapCol &&
      info.key &&
      current.dashes.length === 0
    ) {
      siblings.push(info.key)
    }

    // Levels in this line from right to left: the key, then each dash.
    const levels: { col: number; kind: 'key' | 'item' }[] = []
    if (info.key !== undefined) levels.push({ col: info.contentCol, kind: 'key' })
    for (let d = info.dashes.length - 1; d >= 0; d--) {
      levels.push({ col: info.dashes[d] ?? 0, kind: 'item' })
    }
    for (const level of levels) {
      const higher = level.col < limit
      const equalOwner =
        allowEqual &&
        level.kind === 'key' &&
        level.col === limit &&
        !info.hasValue &&
        !info.dashes.length
      if (!higher && !equalOwner) continue
      if (first && info.blockScalar && level.kind === 'key') {
        return { path: [], insideScalar: true, siblings }
      }
      first = false
      // After a list item, the key that owns the list may sit at the item's own column.
      allowEqual = level.kind === 'item'
      limit = level.col
      path.unshift(level.kind === 'item' ? '-' : (info.key ?? ''))
    }
    if (limit === 0 && !allowEqual) break
  }
  return { path, insideScalar: false, siblings }
}

// -- From a path to the kind of mapping --------------------------------------------------------

const STEP_PATH =
  /^scenarios\/[^/]+\/(?:phases\/-\/)?steps\/-(?:\/par\/-)*(?:\/(?!par$)[^/]+)?$|^(?:phases\/-\/)?steps\/-(?:\/par\/-)*(?:\/(?!par$)[^/]+)?$/

/**
 * The kind of mapping at `path`, or undefined where no keys are expected (the map of node ids,
 * a list of strings). In a scenario file the path starts inside the scenario.
 */
export function contextOf(path: string[], file: 'diagram' | 'scenario'): Context | undefined {
  const p = file === 'scenario' ? ['scenarios', '_', ...path] : path
  const joined = p.join('/')
  if (p.length === 0) return 'root'
  if (STEP_PATH.test(joined)) return 'step'
  const [a, , c, d] = p
  switch (a) {
    case 'defaults':
      return p.length === 1 ? 'defaults' : undefined
    case 'nodes':
      if (p.length === 2) return 'node'
      if (p.length === 4 && c === 'chips' && d === '-') return 'chip'
      if (p.length === 4 && c === 'links' && d === '-') return 'link'
      return undefined
    case 'groups':
      return p.length === 2 ? 'group' : undefined
    case 'edges':
      return p[1] === '-' && p.length <= 3 ? 'edge' : undefined
    case 'views':
      return p.length === 2 ? 'view' : undefined
    case 'kinds':
      return p.length === 2 ? 'kind' : undefined
    case 'edgeKinds':
      return p.length === 2 ? 'edgeKind' : undefined
    case 'scenarios':
      if (p.length === 2) return 'scenario'
      if (p.length === 4 && c === 'phases' && d === '-') return 'phase'
      if (p.length === 4 && c === 'lanes' && d === '-') return 'lane'
      return undefined
    default:
      return undefined
  }
}

/** Whether the mapping at `path` is the extra-properties part of `a -> b: { ... }`. */
export function isCompact(path: string[]): boolean {
  const last = path[path.length - 1] ?? ''
  return /->|^at\s/.test(last)
}

/** Whether the cursor is in a list of edges or steps, where `a -> b` may be written. */
export function listKind(
  path: string[],
  file: 'diagram' | 'scenario',
): 'edges' | 'steps' | undefined {
  const joined = (file === 'scenario' ? ['scenarios', '_', ...path] : path).join('/')
  if (joined === 'edges/-') return 'edges'
  if (/^scenarios\/[^/]+\/(?:phases\/-\/)?steps\/-(?:\/par\/-)*$/.test(joined)) return 'steps'
  return undefined
}
