import { describe, expect, it } from 'vitest'
import {
  type CompiledDiagram,
  canExpand,
  canOpen,
  defaultExpanded,
  INLINE_PAD,
  layoutNested,
  layoutView,
  measurable,
  openingView,
  type Rect,
  rectOfPath,
} from '../src'
import { compileText, loadDocs } from './helpers'

const docs = loadDocs().diagrams
const shop = docs['nest-shop']!
const nested = shop.nested!
const diagrams = { ...nested, [shop.name]: undefined }

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const inside = (i: Rect, o: Rect, slack = 1) =>
  i.x >= o.x - slack &&
  i.y >= o.y - slack &&
  i.x + i.w <= o.x + o.w + slack &&
  i.y + i.h <= o.y + o.h + slack
function distToBorder(p: { x: number; y: number }, r: Rect) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h))
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy)
  return Math.min(p.x - r.x, r.x + r.w - p.x, p.y - r.y, r.y + r.h - p.y)
}

/** Fixed card sizes for every node that has to be measured, as a browser would report them. */
const sizesFor = (d: CompiledDiagram, viewId: string, expanded: Set<string>) =>
  Object.fromEntries(
    measurable(d, viewId, expanded, diagrams).map(({ key }) => [key, { w: 178, h: 84 }]),
  )

const lay = (expanded: string[], d: CompiledDiagram = shop, ds = diagrams) => {
  const set = new Set(expanded)
  const sizes = Object.fromEntries(
    measurable(d, d.views[0]!.id, set, ds).map(({ key }) => [key, { w: 178, h: 84 }]),
  )
  return layoutNested(d, d.views[0]!.id, { sizes, expanded: set, diagrams: ds })
}

describe('layoutNested', () => {
  it('is the plain layout while nothing is expanded', async () => {
    const plain = await layoutView(
      shop,
      'overview',
      sizesFor(shop, 'overview', new Set()) as Record<string, { w: number; h: number }>,
    )
    const none = await lay([])
    expect(none.inner).toEqual({})
    expect(none.layout).toEqual(plain)
  })

  it('makes an expanded node exactly as large as the diagram inside it plus its frame', async () => {
    const out = await lay(['orders'])
    const inner = out.inner.orders!
    const rect = out.layout.nodes.orders!
    expect(inner.name).toBe('nest-orders')
    expect(rect.w).toBeCloseTo(inner.layout.layout.width + INLINE_PAD.left + INLINE_PAD.right)
    expect(rect.h).toBeCloseTo(inner.layout.layout.height + INLINE_PAD.top + INLINE_PAD.bottom)
    expect(inner.offset).toEqual({ x: INLINE_PAD.left, y: INLINE_PAD.top })
  })

  it('keeps the inner diagram inside the node and every other node clear of it', async () => {
    const out = await lay(['orders'])
    const rect = out.layout.nodes.orders!
    const at = out.inner.orders!.offset
    for (const r of Object.values(out.inner.orders!.layout.layout.nodes)) {
      expect(inside({ ...r, x: r.x + rect.x + at.x, y: r.y + rect.y + at.y }, rect)).toBe(true)
    }
    for (const [id, other] of Object.entries(out.layout.nodes)) {
      if (id !== 'orders') expect(overlaps(rect, other), id).toBe(false)
    }
  })

  it('still ends the edges of the expanded node on its border', async () => {
    const out = await lay(['orders'])
    for (const e of Object.values(shop.edges)) {
      const l = out.layout.edges[e.id]!
      expect(distToBorder(l.points[0]!, out.layout.nodes[e.from]!), e.id).toBeLessThan(2)
      expect(distToBorder(l.points.at(-1)!, out.layout.nodes[e.to]!), e.id).toBeLessThan(2)
    }
  })

  it('goes as deep as it is asked to, and each level makes the one above larger', async () => {
    const one = await lay(['orders'])
    const two = await lay(['orders', 'orders/stock'])
    const stock = two.inner.orders!.layout.inner.stock!
    expect(stock.name).toBe('nest-stock')
    expect(two.layout.nodes.orders!.w).toBeGreaterThan(one.layout.nodes.orders!.w)
    expect(two.layout.nodes.orders!.h).toBeGreaterThan(one.layout.nodes.orders!.h)
  })

  it('ignores a deeper path whose parent is not expanded', async () => {
    const out = await lay(['orders/stock'])
    expect(out.inner).toEqual({})
  })

  it('does not expand what is limited to `open`, or what is not at hand', async () => {
    const limited: CompiledDiagram = {
      ...shop,
      nodes: {
        ...shop.nodes,
        orders: { ...shop.nodes.orders!, diagram: { name: 'nest-orders', mode: 'open' } },
      },
    }
    expect((await lay(['orders'], limited)).inner).toEqual({})
    const without = { ...diagrams, 'nest-orders': undefined }
    expect((await lay(['orders'], shop, without)).inner).toEqual({})
  })

  it('refuses a view that does not exist', async () => {
    await expect(layoutNested(shop, 'nope')).rejects.toThrow('Unknown view')
  })
})

describe('rectOfPath', () => {
  it('finds a node at the top, and one inside an expanded node, in the same world', async () => {
    const out = await lay(['orders', 'orders/stock'])
    expect(rectOfPath(out, 'orders')).toEqual(out.layout.nodes.orders)
    const outer = out.layout.nodes.orders!
    const inner = out.inner.orders!
    const stock = inner.layout.layout.nodes.stock!
    expect(rectOfPath(out, 'orders/stock')).toEqual({
      x: outer.x + inner.offset.x + stock.x,
      y: outer.y + inner.offset.y + stock.y,
      w: stock.w,
      h: stock.h,
    })
    const deep = out.inner.orders!.layout.inner.stock!
    const api = deep.layout.layout.nodes.api!
    const abs = rectOfPath(out, 'orders/stock/api')!
    expect(abs.w).toBe(api.w)
    expect(abs.x).toBeGreaterThan(rectOfPath(out, 'orders/stock')!.x)
  })

  it('is undefined for a path that is not laid out', async () => {
    const out = await lay(['orders'])
    expect(rectOfPath(out, 'orders/stock/api')).toBeUndefined()
    expect(rectOfPath(out, 'nope')).toBeUndefined()
    expect(rectOfPath(out, 'browser/x')).toBeUndefined()
  })
})

describe('what may be done with a node', () => {
  const at = (mode?: 'both' | 'expand' | 'open') => ({ name: 'nest-stock', mode })
  it('offers both unless the author limited it', () => {
    expect([canExpand(at(), diagrams), canOpen(at(), diagrams)]).toEqual([true, true])
    expect([canExpand(at('expand'), diagrams), canOpen(at('expand'), diagrams)]).toEqual([
      true,
      false,
    ])
    expect([canExpand(at('open'), diagrams), canOpen(at('open'), diagrams)]).toEqual([false, true])
  })

  it('offers nothing when the diagram is not at hand, or there is none', () => {
    expect(canExpand({ name: 'gone' }, diagrams)).toBe(false)
    expect(canOpen(undefined, diagrams)).toBe(false)
  })
})

describe('defaultExpanded and measurable', () => {
  const flagged = (mode?: 'both' | 'expand' | 'open'): CompiledDiagram => ({
    ...shop,
    nodes: {
      ...shop.nodes,
      orders: { ...shop.nodes.orders!, diagram: { name: 'nest-orders', expanded: true, mode } },
    },
  })
  const deepNested = {
    ...diagrams,
    'nest-orders': {
      ...nested['nest-orders']!,
      nodes: {
        ...nested['nest-orders']!.nodes,
        stock: {
          ...nested['nest-orders']!.nodes.stock!,
          diagram: { name: 'nest-stock', expanded: true },
        },
      },
    },
  }

  it('starts the nodes the author flagged expanded, at every depth', () => {
    expect(defaultExpanded(flagged(), deepNested)).toEqual(['orders', 'orders/stock'])
    expect(defaultExpanded(shop, diagrams)).toEqual([])
  })

  it('does not start expanded what is limited to `open`', () => {
    expect(defaultExpanded(flagged('open'), deepNested)).toEqual([])
  })

  it('lists the cards to measure, by path, through every expanded level', () => {
    const keys = (set: string[]) =>
      measurable(shop, 'overview', new Set(set), diagrams).map((m) => m.key)
    expect(keys([])).toEqual(['browser', 'gateway', 'orders', 'payments', 'mailer'])
    expect(keys(['orders'])).toEqual(
      expect.arrayContaining(['orders', 'orders/api', 'orders/stock', 'orders/db']),
    )
    expect(keys(['orders'])).not.toContain('orders/stock/api')
    expect(keys(['orders', 'orders/stock'])).toContain('orders/stock/warehouse')
  })
})

describe('openingView', () => {
  const payments = docs.payments!
  it('prefers the named view, then the scenario view, then the first', () => {
    const view = payments.views[0]!.id
    expect(openingView(payments, { name: 'payments', view })).toBe(view)
    expect(openingView(payments, { name: 'payments' })).toBe(view)
    expect(openingView(payments, { name: 'payments', view: 'missing' })).toBe(view)
    const scenario = payments.scenarios[0]!
    expect(openingView(payments, { name: 'payments', scenario: scenario.id })).toBe(scenario.view)
  })
})

describe('the diagram key, with its two new options', () => {
  it('takes mode and expanded', () => {
    const r = compileText(
      'title: T\nnodes:\n  svc: { diagram: { name: x, mode: expand, expanded: true } }\n',
    )
    expect(r.diagnostics).toEqual([])
    expect(r.diagram!.nodes.svc!.diagram).toEqual({ name: 'x', mode: 'expand', expanded: true })
  })

  it('rejects a mode that does not exist', () => {
    const r = compileText('title: T\nnodes:\n  svc: { diagram: { name: x, mode: inline } }\n')
    expect(r.diagram).toBeUndefined()
    expect(r.diagnostics[0]!.severity).toBe('error')
  })

  it('warns about `expanded` on a node that can only be opened', () => {
    const r = compileText(
      'title: T\nnodes:\n  svc:\n    diagram: { name: x, mode: open, expanded: true }\n',
    )
    expect(r.diagram).toBeDefined()
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({ severity: 'warning', line: 4 })
    expect(r.diagnostics[0]!.hint).toContain('mode: expand')
  })
})
