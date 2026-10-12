import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { loadProject } from '@the-package-labs/idocs-core/node'
import { describe, expect, it } from 'vitest'
import { compileFolder, refBasesFor, refPath, staleRefs } from '../src/model/compile'
import { gatherSource, nodeFs } from '../src/model/sources'
import { icons, MINI, makeProject, repo } from './helpers/project'

const roots = [join(repo, 'apps/docs'), join(repo, 'templates/starter')]

const folders = roots.flatMap((root) =>
  readdirSync(join(root, 'diagrams'))
    .filter((n) => statSync(join(root, 'diagrams', n)).isDirectory())
    .map((name) => ({ root, name, folder: join(root, 'diagrams', name) })),
)

// The extension gathers files itself so it can read unsaved editor text. Whatever it gathers must
// compile to exactly what the loader behind `idocs check` and the Astro integration produces.
describe('compileFolder matches the real loader', () => {
  it('finds the repository diagrams', () => {
    expect(folders.length).toBeGreaterThan(15)
  })

  for (const { root, name, folder } of folders) {
    it(`${relative(repo, folder)}`, () => {
      const expected = loadProject(root)
      const outcome = compileFolder(folder, {
        fs: nodeFs(),
        icons,
        refBases: refBasesFor(folder, []),
      })
      expect(outcome).toBeDefined()
      // The loader also attaches the diagrams a diagram opens; a single folder cannot know them.
      const { nested: _, ...theirDiagram } = expected.diagrams[name]!
      expect(outcome?.diagram).toEqual(theirDiagram)
      // Same problems, ignoring the path style and the stale-reference warnings added on top.
      const own = outcome?.diagnostics.filter((d) => !d.message.includes('cites')) ?? []
      const theirs = expected.diagnostics.filter((d) => d.file.includes(`diagrams/${name}/`))
      expect(own.map((d) => [d.severity, d.message, d.line, d.col])).toEqual(
        theirs.map((d) => [d.severity, d.message, d.line, d.col]),
      )
    })
  }
})

describe('gatherSource', () => {
  it('prefers unsaved text and sees scenario files', () => {
    const root = makeProject({
      'diagrams/mini/diagram.yaml': MINI,
      'diagrams/mini/scenarios/extra.yaml': 'title: Extra\nsteps:\n  - web -> api\n',
    })
    const folder = join(root, 'diagrams/mini')
    const open = new Map([[join(folder, 'diagram.yaml'), 'title: Edited\nnodes: {}\n']])
    const src = gatherSource(folder, nodeFs({ text: (p) => open.get(p), has: (p) => open.has(p) }))
    expect(src?.text).toBe('title: Edited\nnodes: {}\n')
    expect(src?.scenarioFiles?.map((s) => s.id)).toEqual(['extra'])
    expect(src?.name).toBe('mini')
  })

  it('returns nothing for a folder without a diagram', () => {
    const root = makeProject({ 'diagrams/x/readme.md': 'hi' })
    expect(gatherSource(join(root, 'diagrams/x'), nodeFs())).toBeUndefined()
  })

  it('does not read outside the diagram folder', () => {
    const root = makeProject({
      'diagrams/mini/diagram.yaml': MINI,
      'secret.md': 'secret',
    })
    const src = gatherSource(join(root, 'diagrams/mini'), nodeFs())
    expect(src?.readFile?.('../../secret.md')).toBeUndefined()
    expect(src?.readFile?.('nodes/none.md')).toBeUndefined()
  })
})

describe('stale references', () => {
  it('parses what counts as a path', () => {
    expect(refPath('src/api.ts')).toBe('src/api.ts')
    expect(refPath('src/api.ts:40')).toBe('src/api.ts')
    expect(refPath('src/api.ts#L10-L20')).toBe('src/api.ts')
    expect(refPath('https://example.com/x')).toBeUndefined()
    expect(refPath('README')).toBeUndefined()
  })

  it('warns at the reference that points nowhere', () => {
    const root = makeProject({
      'diagrams/mini/diagram.yaml': MINI,
      'src/api.ts': '',
    })
    const folder = join(root, 'diagrams/mini')
    const outcome = compileFolder(folder, {
      fs: nodeFs(),
      icons,
      refBases: refBasesFor(folder, []),
    })
    const stale = outcome?.diagnostics.filter((d) => d.message.includes('cites')) ?? []
    expect(stale).toHaveLength(1)
    expect(stale[0]).toMatchObject({
      severity: 'warning',
      message: 'Node "api" cites "src/missing.ts", which does not exist',
      file: join(folder, 'diagram.yaml'),
    })
    const line = MINI.split('\n')[(stale[0]?.line ?? 1) - 1]
    expect(line?.slice((stale[0]?.col ?? 1) - 1)).toMatch(/^src\/missing\.ts/)
  })

  it('looks in the workspace folders too', () => {
    const root = makeProject({
      'diagrams/mini/diagram.yaml': MINI,
      'other/src/api.ts': '',
      'other/src/missing.ts': '',
    })
    const folder = join(root, 'diagrams/mini')
    const outcome = compileFolder(folder, {
      fs: nodeFs(),
      icons,
      refBases: refBasesFor(folder, [join(root, 'other')]),
    })
    expect(outcome?.diagnostics.filter((d) => d.message.includes('cites'))).toEqual([])
    expect(staleRefs).toBeTypeOf('function')
  })
})

describe('compileFolder', () => {
  it('reports errors with absolute paths and no diagram', () => {
    const root = makeProject({
      'diagrams/bad/diagram.yaml': 'title: Bad\nnodes:\n  a: { kind: service, nope: 1 }\n',
    })
    const folder = join(root, 'diagrams/bad')
    const outcome = compileFolder(folder, { fs: nodeFs(), icons, refBases: [] })
    expect(outcome?.diagram).toBeUndefined()
    expect(outcome?.diagnostics[0]).toMatchObject({
      severity: 'error',
      file: join(folder, 'diagram.yaml'),
      line: 3,
    })
  })
})
