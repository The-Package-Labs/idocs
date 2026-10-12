import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileFolder } from '../src/model/compile'
import { linkProblems, nestedFor, sameProject } from '../src/model/links'
import { nodeFs } from '../src/model/sources'
import { icons, makeProject } from './helpers/project'

const LEAF = 'title: Leaf\nnodes:\n  a: A\nviews:\n  main: {}\n  deep: {}\n'

function outcomes(files: Record<string, string>, root = makeProject(files)) {
  const names = [...new Set(Object.keys(files).map((p) => p.split('/')[1]!))]
  const list = names.map(
    (name) => compileFolder(join(root, 'diagrams', name), { fs: nodeFs(), icons, refBases: [] })!,
  )
  return { root, list }
}

describe('linkProblems', () => {
  it('files a missing diagram under the folder that wrote it, at an absolute path', () => {
    const { root, list } = outcomes({
      'diagrams/shop/diagram.yaml': 'title: Shop\nnodes:\n  pay: { diagram: leef }\n',
      'diagrams/leaf/diagram.yaml': LEAF,
    })
    const problems = linkProblems(list)
    const shop = join(root, 'diagrams/shop')
    expect([...problems.keys()]).toEqual([shop])
    expect(problems.get(shop)![0]).toMatchObject({
      severity: 'error',
      file: join(shop, 'diagram.yaml'),
      line: 3,
    })
    expect(problems.get(shop)![0]!.hint).toContain('"leaf"')
  })

  it('has nothing to say when every link holds', () => {
    const { list } = outcomes({
      'diagrams/shop/diagram.yaml':
        'title: Shop\nnodes:\n  pay: { diagram: { name: leaf, view: deep } }\n',
      'diagrams/leaf/diagram.yaml': LEAF,
    })
    expect(linkProblems(list).size).toBe(0)
  })

  it('does not mix projects: a diagram of another diagrams/ folder does not count', () => {
    const a = outcomes({
      'diagrams/shop/diagram.yaml': 'title: S\nnodes:\n  p: { diagram: leaf }\n',
    })
    const b = outcomes({ 'diagrams/leaf/diagram.yaml': LEAF })
    const problems = linkProblems([...a.list, ...b.list])
    expect(problems.get(a.list[0]!.folder)![0]!.message).toContain('does not exist')
  })

  it('names the circle, once', () => {
    const { list } = outcomes({
      'diagrams/a/diagram.yaml': 'title: A\nnodes:\n  x: { diagram: b }\n',
      'diagrams/b/diagram.yaml': 'title: B\nnodes:\n  y: { diagram: a }\n',
    })
    const all = [...linkProblems(list).values()].flat()
    expect(all).toHaveLength(1)
    expect(all[0]!.hint).toContain('a → b → a')
  })
})

describe('nestedFor and sameProject', () => {
  it('collects what a diagram can open, from the newest version of each', () => {
    const { list } = outcomes({
      'diagrams/shop/diagram.yaml': 'title: Shop\nnodes:\n  o: { diagram: orders }\n',
      'diagrams/orders/diagram.yaml': 'title: Orders\nnodes:\n  s: { diagram: stock }\n',
      'diagrams/stock/diagram.yaml': LEAF,
      'diagrams/other/diagram.yaml': LEAF,
    })
    const known = list.map((o) => ({ folder: o.folder, name: o.name, diagram: o.diagram }))
    const shop = list.find((o) => o.name === 'shop')!
    expect(Object.keys(nestedFor(shop.folder, known)).sort()).toEqual(['orders', 'stock'])
    expect(sameProject(shop.folder, known)).toHaveLength(4)
  })

  it('keeps a diagram that has errors right now usable through its last good version', () => {
    const { list } = outcomes({
      'diagrams/shop/diagram.yaml': 'title: Shop\nnodes:\n  o: { diagram: orders }\n',
      'diagrams/orders/diagram.yaml': LEAF,
    })
    const shop = list.find((o) => o.name === 'shop')!
    const orders = list.find((o) => o.name === 'orders')!
    const known = [
      { folder: shop.folder, name: 'shop', diagram: shop.diagram },
      { folder: orders.folder, name: 'orders', diagram: orders.diagram },
    ]
    expect(Object.keys(nestedFor(shop.folder, known))).toEqual(['orders'])
  })
})
