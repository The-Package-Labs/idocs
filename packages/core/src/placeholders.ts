// Placeholders in commands: `{yourname}` and `<you_pat>` are values the reader fills in before they
// copy. Pure and browser-safe: the compiler marks them in code blocks, the viewer and the Astro
// component read them with the same functions.

export type PlaceholderSegment =
  | { kind: 'text'; text: string }
  | {
      kind: 'var'
      /** As written, braces or angle brackets included: `{yourname}`. */
      raw: string
      /** As written, without them: `yourname`. */
      name: string
      /** What `{Token}`, `<token>` and `<TOKEN>` share, so one value fills them all. */
      key: string
    }

export interface Placeholder {
  key: string
  /** The first spelling in the text. */
  name: string
  raw: string
  /** A token or a password: kept in memory, never stored, masked on the page. */
  secret: boolean
}

// Written so that what looks like a placeholder but is shell, a template or JSON is left alone:
// `${HOME}`, `{{ name }}`, `{a,b}`, `{1..3}`, `{ "a": 1 }`, `<<EOF`, `< file`. A backslash turns one off.
const TOKEN =
  /\\([{<][A-Za-z_][\w-]*[}>])|(?<![${])\{([A-Za-z_][\w-]*)\}(?!\})|(?<!<)<([A-Za-z_][\w-]*)>/g

export function varKey(name: string): string {
  return name.toLowerCase().replace(/-/g, '_')
}

/** Words that mark a value as a secret: `you_pat`, `api_key`, `password`, but not `monkey`. */
const SECRET = /(^|_)(pat|token|jwt|secret|password|passwd|pwd|apikey|key|credentials?)s?($|_)/

export function isSecretKey(key: string): boolean {
  return SECRET.test(key)
}

export function splitPlaceholders(text: string): PlaceholderSegment[] {
  const out: PlaceholderSegment[] = []
  const push = (s: string) => {
    if (!s) return
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += s
    else out.push({ kind: 'text', text: s })
  }
  let at = 0
  for (const m of text.matchAll(TOKEN)) {
    push(text.slice(at, m.index))
    at = m.index + m[0].length
    if (m[1] !== undefined) {
      push(m[1])
      continue
    }
    const name = (m[2] ?? m[3]) as string
    out.push({ kind: 'var', raw: m[0], name, key: varKey(name) })
  }
  push(text.slice(at))
  return out
}

/** Each distinct placeholder once, in the order the text first uses it. */
export function placeholdersOf(segments: PlaceholderSegment[]): Placeholder[] {
  const seen = new Map<string, Placeholder>()
  for (const s of segments) {
    if (s.kind === 'var' && !seen.has(s.key)) {
      seen.set(s.key, { key: s.key, name: s.name, raw: s.raw, secret: isSecretKey(s.key) })
    }
  }
  return [...seen.values()]
}

/** The value of a placeholder, or undefined while the reader has not set one (an empty one is not set). */
function valueFor(values: Record<string, string>, key: string): string | undefined {
  // Own keys only: `{constructor}` and `{__proto__}` are names a reader can write.
  const v = Object.hasOwn(values, key) ? values[key] : undefined
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** The text to copy: values where the reader set them, the placeholder as written where not. */
export function fillSegments(
  segments: PlaceholderSegment[],
  values: Record<string, string>,
): string {
  return segments
    .map((s) => (s.kind === 'text' ? s.text : (valueFor(values, s.key) ?? s.raw)))
    .join('')
}

export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return fillSegments(splitPlaceholders(text), values)
}

/** Placeholders in `segments` the reader has not set. */
export function unsetPlaceholders(
  segments: PlaceholderSegment[],
  values: Record<string, string>,
): Placeholder[] {
  return placeholdersOf(segments).filter((p) => valueFor(values, p.key) === undefined)
}

export interface Shown {
  text: string
  state: 'unset' | 'set' | 'secret'
}

const MASK = '••••••••'

/** What the page shows in place of a placeholder: the value, a mask for a secret, or the placeholder. */
export function shownPlaceholder(
  segment: Extract<PlaceholderSegment, { kind: 'var' }>,
  values: Record<string, string>,
): Shown {
  const v = valueFor(values, segment.key)
  if (v === undefined) return { text: segment.raw, state: 'unset' }
  return isSecretKey(segment.key) ? { text: MASK, state: 'secret' } : { text: v, state: 'set' }
}

// Languages where `{name}` and `<name>` are not code: shell, plain text and configuration. In
// TypeScript, JSX, HTML or C++ they are, so those are left alone unless the block asks (`vars`).
const COMMAND_LANGUAGES = new Set([
  '',
  'sh',
  'bash',
  'shell',
  'zsh',
  'fish',
  'console',
  'shellsession',
  'powershell',
  'pwsh',
  'ps1',
  'bat',
  'cmd',
  'text',
  'txt',
  'plain',
  'env',
  'dotenv',
  'ini',
  'toml',
  'yaml',
  'yml',
  'http',
])

/** Whether a code block takes placeholders: by language, and `vars` / `novars` in the fence info decide otherwise. */
export function takesPlaceholders(lang: string | undefined, meta: string | undefined): boolean {
  const words = (meta ?? '').split(/\s+/)
  if (words.includes('novars')) return false
  if (words.includes('vars')) return true
  return COMMAND_LANGUAGES.has((lang ?? '').toLowerCase())
}
