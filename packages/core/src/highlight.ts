// A small syntax highlighter for the code blocks of a diagram's documentation. Pure and browser-safe,
// so the compiler, the Astro component and the editor's preview colour a block the same way, in the
// theme's own colours (the classes map to --idocs-* tokens). It knows what commands and
// configuration look like: shell, YAML, JSON, HTTP, INI/TOML/.env. Other languages get strings,
// numbers and comments, and the rest is left plain. The tokens always add up to the text.

import type { PlaceholderSegment } from './placeholders'

export type TokenClass =
  | 'comment'
  | 'string'
  | 'keyword'
  | 'flag'
  | 'number'
  | 'variable'
  | 'key'
  | 'literal'
  | 'operator'
  | 'section'

export interface Token {
  text: string
  cls?: TokenClass
}

type Family = 'shell' | 'yaml' | 'json' | 'http' | 'ini' | 'env' | 'clike' | 'hash' | 'sql'

const FAMILIES: Record<Family, string[]> = {
  shell: [
    'sh',
    'bash',
    'zsh',
    'shell',
    'console',
    'shellsession',
    'fish',
    'powershell',
    'pwsh',
    'ps1',
  ],
  yaml: ['yaml', 'yml'],
  json: ['json', 'jsonc', 'json5'],
  http: ['http'],
  ini: ['ini', 'toml', 'properties'],
  env: ['env', 'dotenv'],
  clike: [
    ...['js', 'javascript', 'jsx', 'mjs', 'cjs', 'ts', 'typescript', 'tsx', 'java', 'c', 'cpp'],
    ...['c++', 'cs', 'csharp', 'go', 'rust', 'rs', 'swift', 'kotlin', 'scala', 'php', 'dart'],
    ...['css', 'scss', 'less'],
  ],
  hash: [
    ...['py', 'python', 'rb', 'ruby', 'perl', 'r', 'make', 'makefile', 'dockerfile', 'nginx'],
    ...['conf', 'hcl', 'terraform', 'tf', 'graphql'],
  ],
  sql: ['sql'],
}

const FAMILY_OF = new Map<string, Family>(
  (Object.entries(FAMILIES) as [Family, string[]][]).flatMap(([f, langs]) =>
    langs.map((l): [string, Family] => [l, f]),
  ),
)

const LABELS: Record<string, string> = {
  sh: 'Shell',
  shell: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  fish: 'Fish',
  console: 'Console',
  shellsession: 'Console',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  ps1: 'PowerShell',
  bat: 'Batch',
  cmd: 'Batch',
  yaml: 'YAML',
  yml: 'YAML',
  json: 'JSON',
  jsonc: 'JSON',
  json5: 'JSON5',
  http: 'HTTP',
  env: '.env',
  dotenv: '.env',
  ini: 'INI',
  toml: 'TOML',
  properties: 'Properties',
  text: 'Text',
  txt: 'Text',
  plain: 'Text',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  ruby: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  rust: 'Rust',
  cs: 'C#',
  csharp: 'C#',
  cpp: 'C++',
  html: 'HTML',
  xml: 'XML',
  css: 'CSS',
  scss: 'SCSS',
  sql: 'SQL',
  md: 'Markdown',
  mdx: 'MDX',
  markdown: 'Markdown',
  diff: 'Diff',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  tf: 'Terraform',
  terraform: 'Terraform',
  hcl: 'HCL',
  php: 'PHP',
  java: 'Java',
  c: 'C',
}

/** The name of a language as a block's header shows it. Blocks with none are text. */
export function languageLabel(lang: string | undefined): string {
  const l = (lang ?? '').toLowerCase()
  if (!l) return 'Text'
  return LABELS[l] ?? l.charAt(0).toUpperCase() + l.slice(1)
}

/** Joins neighbours of one class, so a token is a run and not a character. */
class Painter {
  tokens: Token[] = []
  put(text: string, cls?: TokenClass) {
    if (!text) return
    const last = this.tokens[this.tokens.length - 1]
    if (last && last.cls === cls) last.text += text
    else this.tokens.push(cls ? { text, cls } : { text })
  }
}

export function highlight(lang: string | undefined, text: string): Token[] {
  const family = FAMILY_OF.get((lang ?? '').toLowerCase())
  if (!family || !text) return text ? [{ text }] : []
  const p = new Painter()
  switch (family) {
    case 'shell':
      shell(text, p)
      break
    case 'yaml':
      yaml(text, p)
      break
    case 'json':
      json(text, p)
      break
    case 'http':
      http(text, p)
      break
    case 'ini':
    case 'env':
      ini(text, p)
      break
    default:
      generic(text, p, family)
  }
  return p.tokens
}

// ---------- shell ----------

// After one of these the next word is a command again.
const THEN_COMMAND = new Set([
  ...['sudo', 'env', 'time', 'exec', 'xargs', 'nohup', 'command', 'if', 'then', 'else', 'elif'],
  ...['do', 'while', 'until', '!', '{'],
])
const SHELL_WORD = /^[^\s|&;<>()'"$`\\]+/
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const NUMBER = /^[+-]?\d+(\.\d+)?$/

function shell(text: string, p: Painter) {
  let i = 0
  let command = true
  let continued = false
  const n = text.length

  // A quoted string, with the variables inside double quotes picked out. Returns where it ends.
  const quoted = (at: number): number => {
    const q = text[at] as string
    let j = at + 1
    let chunk = q
    while (j < n && text[j] !== q) {
      if (q !== "'" && text[j] === '\\' && j + 1 < n) {
        chunk += text.slice(j, j + 2)
        j += 2
        continue
      }
      if (q === '"' && text[j] === '$') {
        const v = text.slice(j).match(/^\$(?:\{[^}\n]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9@*?#!$-])/)
        if (v) {
          p.put(chunk, 'string')
          p.put(v[0], 'variable')
          chunk = ''
          j += v[0].length
          continue
        }
      }
      chunk += text[j]
      j++
    }
    if (j < n) chunk += q
    p.put(chunk, 'string')
    return Math.min(j + 1, n)
  }

  // One word or string that is a value: it does not change what comes next.
  const value = (at: number): number => {
    const c = text[at]
    if (c === '"' || c === "'" || c === '`') return quoted(at)
    if (c === '$') {
      const v = text.slice(at).match(/^\$(?:\{[^}\n]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9@*?#!$-])/)
      if (v) {
        p.put(v[0], 'variable')
        return at + v[0].length
      }
    }
    const w = text.slice(at).match(SHELL_WORD)
    if (w) {
      p.put(w[0], NUMBER.test(w[0]) ? 'number' : undefined)
      return at + w[0].length
    }
    return at
  }

  while (i < n) {
    const c = text[i] as string
    if (c === '\n') {
      p.put(c)
      i++
      if (!continued) command = true
      continued = false
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      const ws = text.slice(i).match(/^[ \t\r]+/)?.[0] as string
      p.put(ws)
      i += ws.length
      continue
    }
    if (c === '\\' && (text[i + 1] === '\n' || (text[i + 1] === '\r' && text[i + 2] === '\n'))) {
      p.put(c, 'operator')
      i++
      continued = true
      continue
    }
    if (c === '#' && (i === 0 || /[\s;|&(]/.test(text[i - 1] as string))) {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? n : end
      p.put(text.slice(i, stop), 'comment')
      i = stop
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      i = quoted(i)
      command = false
      continue
    }
    if (c === '$') {
      if (text[i + 1] === '(') {
        p.put('$(', 'operator')
        i += 2
        command = true
        continue
      }
      const at = i
      i = value(i)
      if (i === at) {
        p.put(c)
        i++
      }
      command = false
      continue
    }
    if ('|&;<>()'.includes(c)) {
      const op = text.slice(i).match(/^(?:\|\||&&|>>|<<|[|&;<>()])/)?.[0] as string
      p.put(op, 'operator')
      i += op.length
      // A file descriptor and its redirect, as in 2>&1, are one operator.
      const fd = text.slice(i).match(/^&\d/)
      if (fd && (op === '>' || op === '<')) {
        p.put(fd[0], 'operator')
        i += fd[0].length
      }
      if ('|&;('.includes(c)) command = true
      continue
    }

    // A word.
    const word = text.slice(i).match(SHELL_WORD)?.[0]
    if (!word) {
      p.put(c)
      i++
      continue
    }
    if (ASSIGN.test(word)) {
      const eq = word.indexOf('=')
      p.put(word.slice(0, eq), 'variable')
      p.put('=', 'operator')
      i += eq + 1
      i = value(i)
      continue
    }
    if (word.startsWith('-') && word.length > 1 && !NUMBER.test(word)) {
      const eq = word.indexOf('=')
      if (eq > 0) {
        p.put(word.slice(0, eq), 'flag')
        p.put('=', 'operator')
        i += eq + 1
        i = value(i)
      } else {
        p.put(word, 'flag')
        i += word.length
      }
      continue
    }
    if (command) {
      p.put(word, 'keyword')
      command = THEN_COMMAND.has(word)
    } else {
      p.put(word, NUMBER.test(word) ? 'number' : undefined)
    }
    i += word.length
  }
}

// ---------- YAML, INI, .env: line by line ----------

const LITERAL = /^(?:true|false|null|yes|no|on|off|~)$/i
const SCALAR_NUMBER = /^[+-]?(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)$/i

/** The value part of a line: strings, numbers, words, and a trailing comment. Says whether it opens a block scalar. */
function scalars(p: Painter, s: string, yaml: boolean): boolean {
  let i = 0
  let block = false
  while (i < s.length) {
    const c = s[i] as string
    if (/\s/.test(c)) {
      const ws = s.slice(i).match(/^\s+/)?.[0] as string
      p.put(ws)
      i += ws.length
    } else if ((c === '#' || (!yaml && c === ';')) && (i === 0 || /\s/.test(s[i - 1] as string))) {
      p.put(s.slice(i), 'comment')
      break
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < s.length && s[j] !== c) j += c === '"' && s[j] === '\\' ? 2 : 1
      p.put(s.slice(i, j + 1), 'string')
      i = j + 1
    } else if ('[]{},'.includes(c)) {
      p.put(c, 'operator')
      i++
    } else if (yaml && /^[|>][+-]?\d*\s*(?:#.*)?$/.test(s.slice(i)) && !s.slice(0, i).trim()) {
      const ind = s.slice(i).match(/^[|>][+-]?\d*/)?.[0] as string
      p.put(ind, 'operator')
      i += ind.length
      block = true
    } else if (yaml && (c === '&' || c === '*')) {
      const w = s.slice(i).match(/^[^\s[\]{},]+/)?.[0] as string
      p.put(w, 'variable')
      i += w.length
    } else if (yaml && c === '!') {
      const w = s.slice(i).match(/^[^\s[\]{},]+/)?.[0] as string
      p.put(w, 'keyword')
      i += w.length
    } else {
      const w = s.slice(i).match(/^[^\s[\]{},]+/)?.[0] ?? c
      p.put(w, SCALAR_NUMBER.test(w) ? 'number' : LITERAL.test(w) ? 'literal' : undefined)
      i += w.length
    }
  }
  return block
}

const YAML_KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s#'"[\]{},&*!|>%@`][^#]*?)(\s*):(?=\s|$)/

function yaml(text: string, p: Painter) {
  let block = -1 // the indent of the key whose block scalar is being read
  const lines = text.split('\n')
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? '\n' : ''
    const body = line.trimStart()
    const indent = line.length - body.length
    if (block >= 0) {
      if (!body.trim() || indent > block) {
        p.put(line, body.trim() ? 'string' : undefined)
        p.put(nl)
        return
      }
      block = -1
    }
    p.put(line.slice(0, indent))
    if (!body) {
      p.put(nl)
      return
    }
    if (body.startsWith('#')) {
      p.put(body, 'comment')
      p.put(nl)
      return
    }
    let rest = body
    let at = indent
    if (/^(?:---|\.\.\.)(?:\s|$)/.test(rest)) {
      p.put(rest.slice(0, 3), 'operator')
      rest = rest.slice(3)
    }
    for (let dash = rest.match(/^-(\s+|$)/); dash; dash = rest.match(/^-(\s+|$)/)) {
      p.put('-', 'operator')
      p.put(dash[1] as string)
      at += dash[0].length
      rest = rest.slice(dash[0].length)
    }
    const key = rest.match(YAML_KEY)
    if (key) {
      p.put(key[1] as string, 'key')
      p.put(key[2] as string)
      p.put(':', 'operator')
      rest = rest.slice(key[0].length)
    }
    if (scalars(p, rest, true)) block = key ? at : indent
    p.put(nl)
  })
}

function ini(text: string, p: Painter) {
  const lines = text.split('\n')
  lines.forEach((line, idx) => {
    const nl = idx < lines.length - 1 ? '\n' : ''
    const body = line.trimStart()
    const indent = line.slice(0, line.length - body.length)
    p.put(indent)
    if (/^[#;]/.test(body)) {
      p.put(body, 'comment')
    } else if (/^\[.*\]\s*$/.test(body)) {
      p.put(body, 'section')
    } else {
      const kv = body.match(/^(export\s+)?([^=#;\s][^=]*?)(\s*)=(\s*)(.*)$/)
      if (kv) {
        if (kv[1]) p.put(kv[1], 'keyword')
        p.put(kv[2] as string, 'key')
        p.put(kv[3] as string)
        p.put('=', 'operator')
        p.put(kv[4] as string)
        scalars(p, kv[5] as string, false)
      } else {
        p.put(body)
      }
    }
    p.put(nl)
  })
}

// ---------- JSON ----------

function json(text: string, p: Painter) {
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i] as string
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      // An unfinished string ends at the line, and the line break is not part of it.
      const end = Math.min(text[j] === '"' ? j + 1 : j, n)
      const isKey = /^\s*:/.test(text.slice(end))
      p.put(text.slice(i, end), isKey ? 'key' : 'string')
      i = end
    } else if (c === '/' && text[i + 1] === '/') {
      const e = text.indexOf('\n', i)
      const stop = e === -1 ? n : e
      p.put(text.slice(i, stop), 'comment')
      i = stop
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2)
      const stop = e === -1 ? n : e + 2
      p.put(text.slice(i, stop), 'comment')
      i = stop
    } else if ('{}[],:'.includes(c)) {
      p.put(c, 'operator')
      i++
    } else {
      const num = text.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0]
      const word = text.slice(i).match(/^[A-Za-z_]\w*/)?.[0]
      if (num) {
        p.put(num, 'number')
        i += num.length
      } else if (word) {
        p.put(word, /^(?:true|false|null)$/.test(word) ? 'literal' : undefined)
        i += word.length
      } else {
        p.put(c)
        i++
      }
    }
  }
}

// ---------- HTTP ----------

const METHODS =
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)(\s+)(\S+)(?:(\s+)(HTTP\/[\d.]+))?(.*)$/
const STATUS = /^(HTTP\/[\d.]+)(\s+)(\d{3})(.*)$/

function http(text: string, p: Painter) {
  const lines = text.split('\n')
  let state: 'start' | 'headers' | 'body' = 'start'
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] as string
    const nl = idx < lines.length - 1 ? '\n' : ''
    if (state === 'body') {
      const rest = lines.slice(idx).join('\n')
      if (/^\s*[{[]/.test(rest)) json(rest, p)
      else p.put(rest)
      return
    }
    if (!line.trim()) {
      state = 'body'
      p.put(line + nl)
      continue
    }
    const req = state === 'start' ? line.match(METHODS) : null
    const res = state === 'start' && !req ? line.match(STATUS) : null
    const header = line.match(/^([A-Za-z][\w-]*)(\s*)(:)(.*)$/)
    if (req) {
      p.put(req[1] as string, 'keyword')
      p.put(req[2] as string)
      p.put(req[3] as string)
      p.put(req[4] ?? '')
      p.put(req[5] ?? '', 'literal')
      p.put(req[6] as string)
    } else if (res) {
      p.put(res[1] as string, 'literal')
      p.put(res[2] as string)
      p.put(res[3] as string, 'number')
      p.put(res[4] as string)
    } else if (header) {
      p.put(header[1] as string, 'key')
      p.put(header[2] as string)
      p.put(':', 'operator')
      p.put(header[4] as string)
    } else {
      p.put(line)
    }
    state = 'headers'
    p.put(nl)
  }
}

// ---------- everything else: strings, numbers, comments ----------

const NUM_AT = /^(?:0x[\da-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)/i
const IDENT = /^[A-Za-z_$][\w$]*/

function generic(text: string, p: Painter, family: 'clike' | 'hash' | 'sql') {
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i] as string
    const prev = text[i - 1] ?? ''
    const lineComment =
      (family === 'clike' && c === '/' && text[i + 1] === '/' && prev !== ':') ||
      (family === 'hash' && c === '#' && (i === 0 || /\s/.test(prev))) ||
      (family === 'sql' && c === '-' && text[i + 1] === '-')
    if (lineComment) {
      const e = text.indexOf('\n', i)
      const stop = e === -1 ? n : e
      p.put(text.slice(i, stop), 'comment')
      i = stop
    } else if (family !== 'hash' && c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2)
      const stop = e === -1 ? n : e + 2
      p.put(text.slice(i, stop), 'comment')
      i = stop
    } else if (c === '"' || c === "'" || c === '`') {
      const triple = family === 'hash' && c !== '`' && text.startsWith(c.repeat(3), i)
      let j = i + (triple ? 3 : 1)
      let closed = false
      while (j < n) {
        if (text[j] === '\\') {
          j += 2
        } else if (triple ? text.startsWith(c.repeat(3), j) : text[j] === c) {
          closed = true
          break
        } else if (c !== '`' && !triple && text[j] === '\n') {
          break
        } else {
          j++
        }
      }
      const stop = Math.min(closed ? j + (triple ? 3 : 1) : j, n)
      p.put(text.slice(i, stop), 'string')
      i = stop
    } else if (/[A-Za-z_$]/.test(c)) {
      const id = text.slice(i).match(IDENT)?.[0] as string
      p.put(id)
      i += id.length
    } else if (/\d/.test(c) && !/[\w$]/.test(prev)) {
      const num = text.slice(i).match(NUM_AT)?.[0] as string
      p.put(num, 'number')
      i += num.length
    } else {
      p.put(c)
      i++
    }
  }
}

// ---------- with placeholders ----------

export type Piece =
  | { kind: 'text'; text: string; cls?: TokenClass }
  | { kind: 'var'; segment: Extract<PlaceholderSegment, { kind: 'var' }> }

// A character no text uses, standing where a placeholder is. The highlighter sees one word, and
// the placeholder goes back in once the colours are known.
const HOLE = ''

/** A block's text as pieces to draw: coloured runs, with each placeholder where it was. */
export function highlightSegments(
  lang: string | undefined,
  segments: PlaceholderSegment[],
): Piece[] {
  const vars = segments.filter(
    (s): s is Extract<PlaceholderSegment, { kind: 'var' }> => s.kind === 'var',
  )
  const text = segments
    .map((s) => (s.kind === 'text' ? s.text.replaceAll(HOLE, '�') : HOLE))
    .join('')
  const out: Piece[] = []
  let next = 0
  for (const t of highlight(lang, text)) {
    t.text.split(HOLE).forEach((part, i) => {
      if (i > 0) out.push({ kind: 'var', segment: vars[next++] as (typeof vars)[number] })
      if (part)
        out.push(t.cls ? { kind: 'text', text: part, cls: t.cls } : { kind: 'text', text: part })
    })
  }
  return out
}
