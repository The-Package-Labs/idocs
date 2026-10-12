import { describe, expect, it } from 'vitest'
import { highlight, highlightSegments, languageLabel, splitPlaceholders, type Token } from '../src'

/** `[text, class]` pairs without the plain runs, which is what a reader sees as colour. */
const coloured = (lang: string, text: string) =>
  highlight(lang, text)
    .filter((t) => t.cls)
    .map((t) => [t.text, t.cls])

const join = (tokens: Token[]) => tokens.map((t) => t.text).join('')

describe('highlighting shell', () => {
  it('colours the command, its flags, strings, variables and comments', () => {
    expect(coloured('sh', 'git commit -m "fix $USER" --amend # why')).toEqual([
      ['git', 'keyword'],
      ['-m', 'flag'],
      ['"fix ', 'string'],
      ['$USER', 'variable'],
      ['"', 'string'],
      ['--amend', 'flag'],
      ['# why', 'comment'],
    ])
  })

  it('finds a command again after a pipe, &&, ; and $(', () => {
    const cmds = coloured('bash', 'a | b && c; d $(e)')
      .filter(([, c]) => c === 'keyword')
      .map(([t]) => t)
    expect(cmds).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('treats the word after sudo or env as a command too, but not an argument', () => {
    const cmds = coloured('sh', 'sudo npm install left-pad')
      .filter(([, c]) => c === 'keyword')
      .map(([t]) => t)
    expect(cmds).toEqual(['sudo', 'npm'])
  })

  it('reads an assignment, a flag with a value, and a continued line', () => {
    expect(coloured('sh', 'export TOKEN=abc \\\n  --name=x')).toEqual([
      ['export', 'keyword'],
      ['TOKEN', 'variable'],
      ['=', 'operator'],
      ['\\', 'operator'],
      ['--name', 'flag'],
      ['=', 'operator'],
    ])
  })

  it('does not take a # inside a word for a comment, nor flags like -1 for options', () => {
    expect(coloured('sh', 'echo a#b -1')).toEqual([
      ['echo', 'keyword'],
      ['-1', 'number'],
    ])
  })

  it('keeps single quotes literal', () => {
    expect(coloured('sh', 'echo \'$HOME "x"\'')).toEqual([
      ['echo', 'keyword'],
      ['\'$HOME "x"\'', 'string'],
    ])
  })
})

describe('highlighting configuration', () => {
  it('colours YAML keys, values and comments, and a block scalar as one string', () => {
    const text =
      'name: web # app\nports:\n  - 8080\n  - "443"\nrun: |\n  echo "a: b"\nenabled: true'
    expect(coloured('yaml', text)).toEqual([
      ['name', 'key'],
      [':', 'operator'],
      ['# app', 'comment'],
      ['ports', 'key'],
      [':', 'operator'],
      ['-', 'operator'],
      ['8080', 'number'],
      ['-', 'operator'],
      ['"443"', 'string'],
      ['run', 'key'],
      [':', 'operator'],
      ['|', 'operator'],
      ['  echo "a: b"', 'string'],
      ['enabled', 'key'],
      [':', 'operator'],
      ['true', 'literal'],
    ])
  })

  it('colours JSON keys apart from string values', () => {
    expect(coloured('json', '{ "a": "b", "n": [1, true] }')).toEqual([
      ['{', 'operator'],
      ['"a"', 'key'],
      [':', 'operator'],
      ['"b"', 'string'],
      [',', 'operator'],
      ['"n"', 'key'],
      [':', 'operator'],
      ['[', 'operator'],
      ['1', 'number'],
      [',', 'operator'],
      ['true', 'literal'],
      [']', 'operator'],
      ['}', 'operator'],
    ])
  })

  it('colours an HTTP request, its headers, and a JSON body', () => {
    const text = 'POST /orders HTTP/1.1\nAuthorization: Bearer abc\n\n{"id": 1}'
    expect(coloured('http', text).map(([t, c]) => `${c}:${t}`)).toEqual([
      'keyword:POST',
      'literal:HTTP/1.1',
      'key:Authorization',
      'operator::',
      'operator:{',
      'key:"id"',
      'operator::',
      'number:1',
      'operator:}',
    ])
  })

  it('colours INI sections, keys and values', () => {
    expect(coloured('toml', '[server]\nport = 8080\nname = "x"')).toEqual([
      ['[server]', 'section'],
      ['port', 'key'],
      ['=', 'operator'],
      ['8080', 'number'],
      ['name', 'key'],
      ['=', 'operator'],
      ['"x"', 'string'],
    ])
  })
})

describe('highlighting other languages', () => {
  it('colours strings, numbers and comments, and not what it does not know', () => {
    expect(coloured('ts', 'const a = "x" + 12 // note\nconst b3 = 1')).toEqual([
      ['"x"', 'string'],
      ['12', 'number'],
      ['// note', 'comment'],
      ['1', 'number'],
    ])
    expect(coloured('python', "x = 'a' # c")).toEqual([
      ["'a'", 'string'],
      ['# c', 'comment'],
    ])
    expect(highlight('html', '<b>x</b>')).toEqual([{ text: '<b>x</b>' }])
    expect(highlight(undefined, 'anything {x}')).toEqual([{ text: 'anything {x}' }])
  })

  it('does not take a URL in code for a comment', () => {
    expect(coloured('ts', 'fetch(url("http://x.dev"))')).toEqual([['"http://x.dev"', 'string']])
    expect(coloured('css', 'a { background: url(http://x.dev/a.png) }')).toEqual([])
  })
})

describe('what the tokens must always be', () => {
  const langs = ['sh', 'yaml', 'json', 'http', 'toml', 'env', 'ts', 'python', 'sql', 'text']
  // Characters that start something in some language, and ordinary ones.
  const alphabet = [...'ab 1-_$#"\'`\\\n\r\t:=|&;<>(){}[],.*!/@%^~?+', '', '�', 'é', '😀']

  const random = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  it('add up to the text, whatever it is', () => {
    const next = random(7)
    for (let round = 0; round < 400; round++) {
      const length = Math.floor(next() * 60)
      const text = Array.from(
        { length },
        () => alphabet[Math.floor(next() * alphabet.length)],
      ).join('')
      for (const lang of langs) {
        expect(join(highlight(lang, text)), `${lang}: ${JSON.stringify(text)}`).toBe(text)
      }
    }
  })

  it('add up to the text for unfinished input, line ends included', () => {
    for (const lang of langs) {
      for (const text of [
        '"open',
        "'open\nnext",
        'a: |\n',
        '{ "a',
        '/* open',
        '$(',
        '\\',
        '--- ',
        '[sec',
      ]) {
        expect(join(highlight(lang, text)), `${lang}: ${JSON.stringify(text)}`).toBe(text)
      }
    }
  })
})

describe('highlighting with placeholders', () => {
  it('puts each placeholder back where it was, inside a string or a word', () => {
    const segs = splitPlaceholders('git clone "https://x/{owner}/{repo}.git" <you_pat>')
    const pieces = highlightSegments('sh', segs)
    expect(pieces.filter((p) => p.kind === 'var').map((p) => p.segment.raw)).toEqual([
      '{owner}',
      '{repo}',
      '<you_pat>',
    ])
    const text = pieces.map((p) => (p.kind === 'text' ? p.text : p.segment.raw)).join('')
    expect(text).toBe('git clone "https://x/{owner}/{repo}.git" <you_pat>')
    // The string is still one colour on either side of the placeholder.
    expect(pieces.filter((p) => p.kind === 'text' && p.cls === 'string').length).toBeGreaterThan(1)
  })

  it('leaves text as it is when there are none, and gives a placeholder back whatever the language', () => {
    expect(highlightSegments('sh', splitPlaceholders('ls'))).toEqual([
      { kind: 'text', text: 'ls', cls: 'keyword' },
    ])
    const pieces = highlightSegments('unknown', splitPlaceholders('a {b} c'))
    expect(pieces.map((p) => p.kind)).toEqual(['text', 'var', 'text'])
  })
})

describe('language labels', () => {
  it('names a language as a header does', () => {
    expect(languageLabel('sh')).toBe('Shell')
    expect(languageLabel('YAML')).toBe('YAML')
    expect(languageLabel('ts')).toBe('TypeScript')
    expect(languageLabel('elixir')).toBe('Elixir')
    expect(languageLabel(undefined)).toBe('Text')
  })
})
