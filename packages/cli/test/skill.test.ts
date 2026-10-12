import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILTIN_EDGE_KINDS, BUILTIN_KINDS } from '@the-package-labs/idocs-core'
import { compileDiagram, FamilySchema, KNOWN_KEYS } from '@the-package-labs/idocs-core/node'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { run } from '../src'

// The skill is what other people install with `npx skills add`, and what agents follow. It must
// not drift from the code: these tests fail when the format, the commands or the examples change.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const skillDir = join(repo, 'skills/idocs')

function files(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path, ext) : path.endsWith(ext) ? [path] : []
  })
}

const markdown = files(skillDir, '.md')
const read = (path: string) => readFileSync(path, 'utf8')
const skill = read(join(skillDir, 'SKILL.md'))
const allText = markdown.map(read).join('\n')

describe('skill metadata', () => {
  const front = parse(skill.match(/^---\n([\s\S]*?)\n---/)![1]!) as {
    name: string
    description: string
  }

  it('is named after its folder, as the installer requires', () => {
    expect(front.name).toBe('idocs')
    expect(front.name).toBe(skillDir.split('/').pop())
  })

  it('has a description that says what it does and when to use it, within the limit', () => {
    expect(front.description.length).toBeGreaterThan(200)
    expect(front.description.length).toBeLessThanOrEqual(1024)
    expect(front.description).toMatch(/diagram/i)
    expect(front.description).toMatch(/use when/i)
  })

  it('is reachable by Claude Code in this repository through the same files', () => {
    const linked = join(repo, '.claude/skills/idocs')
    expect(existsSync(join(linked, 'SKILL.md'))).toBe(true)
    expect(realpathSync(linked)).toBe(realpathSync(skillDir))
  })
})

describe('skill files', () => {
  it('only links to files that exist', () => {
    const broken: string[] = []
    for (const file of markdown) {
      for (const [, target] of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target!)) continue
        const path = resolve(dirname(file), target!.split('#')[0]!)
        if (!existsSync(path)) broken.push(`${relative(skillDir, file)} -> ${target}`)
      }
    }
    expect(broken).toEqual([])
  })

  it('has every reference file the main file points at', () => {
    for (const name of ['format', 'scenarios', 'layout', 'setup', 'troubleshooting']) {
      expect(skill, name).toContain(`references/${name}.md`)
      expect(existsSync(join(skillDir, 'references', `${name}.md`))).toBe(true)
    }
  })
})

describe('bundled examples', () => {
  const examples = files(join(skillDir, 'assets/examples'), '.yaml')

  it('includes at least one', () => {
    expect(examples.length).toBeGreaterThan(0)
  })

  for (const file of examples) {
    it(`${relative(skillDir, file)} compiles with no errors and no warnings`, () => {
      const result = compileDiagram({
        name: 'example',
        file: relative(repo, file),
        text: read(file),
      })
      expect(result.diagnostics).toEqual([])
      expect(result.diagram).toBeDefined()
    })
  }

  it('shows the features the skill teaches', () => {
    const diagram = compileDiagram({
      name: 'example',
      file: 'shop.diagram.yaml',
      text: read(examples[0]!),
    }).diagram!
    expect(diagram.views.length).toBeGreaterThan(1)
    expect(Object.values(diagram.groups).some((g) => g.layout === 'rows')).toBe(true)
    expect(Object.values(diagram.groups).some((g) => g.layout === 'row')).toBe(true)
    expect(Object.values(diagram.edges).some((e) => e.hidden)).toBe(true)
    expect(Object.values(diagram.nodes).some((n) => n.status === 'planned')).toBe(true)
    expect(diagram.scenarios.some((s) => s.mode === 'story' && (s.lanes?.length ?? 0) > 0)).toBe(
      true,
    )
    expect(diagram.scenarios.some((s) => s.steps.some((st) => st.par !== undefined))).toBe(true)
    expect(diagram.scenarios.some((s) => s.steps.some((st) => st.kind === 'error'))).toBe(true)
  })
})

describe('skill matches the code', () => {
  const format = read(join(skillDir, 'references/format.md'))

  it('lists exactly the built-in node kinds', () => {
    const listed = format.match(/Node kinds: `([a-z ]+)`/)?.[1]
    expect(listed, 'format.md should have a "Node kinds:" line').toBeDefined()
    const kinds = listed!.split(' ')
    expect(kinds.sort()).toEqual(Object.keys(BUILTIN_KINDS).sort())
  })

  it('mentions every built-in edge kind, step kind and colour family', () => {
    for (const kind of Object.keys(BUILTIN_EDGE_KINDS))
      expect(format, `edge kind ${kind}`).toContain(`\`${kind}\``)
    for (const kind of ['request', 'response', 'error', 'lookup', 'event']) {
      expect(read(join(skillDir, 'references/scenarios.md')), `step kind ${kind}`).toContain(
        `\`${kind}\``,
      )
    }
    for (const family of FamilySchema.options) expect(format, `family ${family}`).toContain(family)
  })

  it('only uses CLI commands and flags that exist', async () => {
    const out: string[] = []
    const log = console.log
    console.log = (m?: unknown) => void out.push(String(m))
    try {
      await run([])
    } finally {
      console.log = log
    }
    const help = out.join('\n')
    const commands = new Set([...help.matchAll(/^\s{2}idocs (\w+)/gm)].map((m) => m[1]!))
    expect([...commands].sort()).toEqual(['check', 'icons', 'list', 'new', 'schema'])

    // A command is `idocs <word>` in a code span, or `pnpm|npx|yarn idocs <word>` anywhere.
    const used = [
      ...allText.matchAll(/`idocs ([a-z]+)/g),
      ...allText.matchAll(/(?:pnpm|npx|yarn) idocs ([a-z]+)/g),
    ].map((m) => m[1]!)
    expect(used.length).toBeGreaterThan(5)
    expect(used.filter((c) => !commands.has(c))).toEqual([])

    const flags = new Set([...allText.matchAll(/ (--[a-z]+)/g)].map((m) => m[1]!))
    for (const flag of flags) {
      if (['--skill', '--list', '--copy', '--global'].includes(flag)) continue
      expect(help, flag).toContain(flag)
    }
  })

  it('documents every field of the schema it describes', () => {
    const fields = readFileSync(join(skillDir, 'references/format.md'), 'utf8')
    for (const key of KNOWN_KEYS.node) expect(fields, `node field ${key}`).toContain(`\`${key}\``)
    for (const key of KNOWN_KEYS.group) expect(fields, `group field ${key}`).toContain(`\`${key}\``)
    for (const key of KNOWN_KEYS.edge) expect(fields, `edge field ${key}`).toContain(`\`${key}\``)
    for (const key of KNOWN_KEYS.view) expect(fields, `view field ${key}`).toContain(`${key}`)
    for (const key of KNOWN_KEYS.defaults) {
      expect(fields, `defaults field ${key}`).toContain(`${key}:`)
    }
    for (const key of KNOWN_KEYS.scenario) {
      expect(read(join(skillDir, 'references/scenarios.md')), `scenario field ${key}`).toContain(
        key,
      )
    }
  })
})
