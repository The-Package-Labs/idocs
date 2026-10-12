import { describe, expect, it } from 'vitest'
import {
  fillPlaceholders,
  isSecretKey,
  type PlaceholderSegment,
  placeholdersOf,
  shownPlaceholder,
  splitPlaceholders,
  takesPlaceholders,
  unsetPlaceholders,
  varKey,
} from '../src'

const names = (text: string) =>
  splitPlaceholders(text).flatMap((s) => (s.kind === 'var' ? [s.raw] : []))

describe('finding placeholders', () => {
  it('reads {name} and <name>, with underscores and dashes', () => {
    expect(names('git clone https://x/{yourname}/{repo-name}.git <you_pat> <TOKEN>')).toEqual([
      '{yourname}',
      '{repo-name}',
      '<you_pat>',
      '<TOKEN>',
    ])
  })

  it('leaves shell, templates and JSON alone', () => {
    const text = [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell, not a template
      'echo ${HOME} $HOME',
      'cp file.{js,ts} out/',
      'seq {1..3}',
      'curl -d \'{"a": 1}\' --data \'{ "b": 2 }\'',
      'cat <<EOF',
      'sort < in.txt > out.txt',
      '{{ mustache }}',
      '{ spaced }',
      '2>&1',
    ].join('\n')
    expect(names(text)).toEqual([])
  })

  it('treats a backslash as an escape and drops it', () => {
    const segs = splitPlaceholders('echo \\{literal} <real>')
    expect(segs).toEqual([
      { kind: 'text', text: 'echo {literal} ' },
      { kind: 'var', raw: '<real>', name: 'real', key: 'real' },
    ])
  })

  it('keeps the text between placeholders whole', () => {
    expect(
      splitPlaceholders('a {x} b {y} c').map((s) => (s.kind === 'text' ? s.text : s.raw)),
    ).toEqual(['a ', '{x}', ' b ', '{y}', ' c'])
  })

  it('lists each placeholder once, in order, under one key however it is spelled', () => {
    const segs = splitPlaceholders('{Token} then <token> then {Other-Thing} then {token}')
    expect(placeholdersOf(segs).map((p) => p.key)).toEqual(['token', 'other_thing'])
    expect(placeholdersOf(segs)[0]).toMatchObject({ name: 'Token', raw: '{Token}', secret: true })
  })
})

describe('filling them in', () => {
  it('replaces every use of a key and leaves the unset ones as written', () => {
    const text = 'git clone https://{user}:<you_pat>@host/{User}/{repo}'
    expect(fillPlaceholders(text, { user: 'ada', you_pat: 's3cret' })).toBe(
      'git clone https://ada:s3cret@host/ada/{repo}',
    )
  })

  it('does not count an empty value as set', () => {
    const segs = splitPlaceholders('run {a} {b}')
    expect(fillPlaceholders('run {a} {b}', { a: '', b: 'x' })).toBe('run {a} x')
    expect(unsetPlaceholders(segs, { a: '', b: 'x' }).map((p) => p.key)).toEqual(['a'])
  })

  it('does not read a value from the prototype of the object', () => {
    expect(fillPlaceholders('{constructor} {__proto__} {toString}', {})).toBe(
      '{constructor} {__proto__} {toString}',
    )
  })

  it('inserts a value as it is, including characters that look like a replacement pattern', () => {
    expect(fillPlaceholders('echo {v}', { v: '$& $1 {w}' })).toBe('echo $& $1 {w}')
  })
})

describe('what the page shows', () => {
  const [seg] = splitPlaceholders('<you_pat>') as [Extract<PlaceholderSegment, { kind: 'var' }>]

  it('shows the placeholder until a value is set, then the value', () => {
    const plain = splitPlaceholders('{name}')[0] as Extract<PlaceholderSegment, { kind: 'var' }>
    expect(shownPlaceholder(plain, {})).toEqual({ text: '{name}', state: 'unset' })
    expect(shownPlaceholder(plain, { name: 'ada' })).toEqual({ text: 'ada', state: 'set' })
  })

  it('masks a secret without giving away its length', () => {
    const a = shownPlaceholder(seg, { you_pat: 'x' })
    const b = shownPlaceholder(seg, { you_pat: 'a-much-longer-token' })
    expect(a).toEqual({ text: '••••••••', state: 'secret' })
    expect(b).toEqual(a)
  })
})

describe('secrets and keys', () => {
  it('recognises the words, not substrings of other words', () => {
    for (const k of [
      'you_pat',
      'token',
      'api_key',
      'apikey',
      'github_token',
      'db_password',
      'secret',
    ]) {
      expect(isSecretKey(k), k).toBe(true)
    }
    for (const k of ['monkey', 'yourname', 'repo', 'patch', 'tokenizer', 'keyboard']) {
      expect(isSecretKey(k), k).toBe(false)
    }
  })

  it('folds case and dashes', () => {
    expect(varKey('Repo-Name')).toBe('repo_name')
  })
})

describe('which blocks take placeholders', () => {
  it('takes shell, plain text and configuration, not code', () => {
    for (const l of [undefined, 'sh', 'bash', 'Shell', 'console', 'yaml', 'env']) {
      expect(takesPlaceholders(l, undefined), String(l)).toBe(true)
    }
    for (const l of ['ts', 'tsx', 'html', 'cpp', 'json']) {
      expect(takesPlaceholders(l, undefined), l).toBe(false)
    }
  })

  it('lets the fence ask for it or refuse it', () => {
    expect(takesPlaceholders('json', 'title="x" vars')).toBe(true)
    expect(takesPlaceholders('sh', 'novars')).toBe(false)
  })
})
