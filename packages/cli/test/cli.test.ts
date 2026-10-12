import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProject } from '@the-package-labs/idocs-core/node'
import { describe, expect, it } from 'vitest'
import { run, staleRefs } from '../src'

function project(yaml: string) {
  const root = mkdtempSync(join(tmpdir(), 'idocs-'))
  mkdirSync(join(root, 'diagrams', 'd'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'real.ts'), '')
  writeFileSync(join(root, 'diagrams', 'd', 'diagram.yaml'), yaml)
  return { root, loaded: loadProject(root) }
}

describe('staleRefs', () => {
  it('flags cited files that are gone, and accepts line suffixes and URLs', () => {
    const { root, loaded } = project(`title: T
nodes:
  api:
    refs: [src/real.ts, "src/real.ts:12", "src/real.ts#L3-L9", src/gone.ts, "https://example.com/x", plain]
`)
    const stale = staleRefs(loaded, [root])
    expect(stale).toHaveLength(1)
    expect(stale[0]!.message).toContain('src/gone.ts')
  })
})

describe('run check', () => {
  it('validates several projects and fails when any has an error', async () => {
    const good = project('title: T\nnodes:\n  a: A\n').root
    const bad = project('title: T\nnodes:\n  a: A\nedges:\n  - a -> nope\n').root
    const logs: string[] = []
    const log = console.log
    console.log = (m?: unknown) => void logs.push(String(m))
    try {
      expect(await run(['check', good])).toBe(0)
      expect(await run(['check', good, bad])).toBe(1)
      logs.length = 0
      expect(await run(['check', good, bad, '--json'])).toBe(1)
      const out = JSON.parse(logs.join('\n'))
      expect(out.ok).toBe(false)
      expect(out.projects).toHaveLength(2)
    } finally {
      console.log = log
    }
  })
})

describe('nested diagrams', () => {
  function folders(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'idocs-'))
    for (const [name, yaml] of Object.entries(files)) {
      mkdirSync(join(root, 'diagrams', name), { recursive: true })
      writeFileSync(join(root, 'diagrams', name, 'diagram.yaml'), yaml)
    }
    return root
  }
  const capture = async (args: string[]) => {
    const logs: string[] = []
    const log = console.log
    console.log = (m?: unknown) => void logs.push(String(m))
    try {
      return { code: await run(args), out: logs.join('\n') }
    } finally {
      console.log = log
    }
  }

  it('fails a check when a node opens a diagram that is not there, and points at it', async () => {
    const root = folders({
      shop: 'title: Shop\nnodes:\n  pay:\n    diagram: paymentz\n',
      payments: 'title: Payments\nnodes:\n  api: API\n',
    })
    const { code, out } = await capture(['check', root])
    expect(code).toBe(1)
    expect(out).toContain('diagrams/shop/diagram.yaml:4:5')
    expect(out).toContain('opens diagram "paymentz"')
    expect(out).toContain('Did you mean "payments"?')
  })

  it('passes when every opened diagram exists, and list says what opens what', async () => {
    const root = folders({
      shop: 'title: Shop\nnodes:\n  pay:\n    diagram: payments\n',
      payments: 'title: Payments\nnodes:\n  api: API\n',
    })
    expect((await capture(['check', root])).code).toBe(0)
    const { out } = await capture(['list', root])
    expect(out).toContain('opens:     pay → payments')
    const json = await capture(['list', root, '--json'])
    expect(JSON.parse(json.out).shop.opens).toEqual([{ node: 'pay', diagram: 'payments' }])
  })
})
