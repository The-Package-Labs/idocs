import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'

const PORT = 4505
const BASE = `http://localhost:${PORT}`
const PAGE = '/format/nested-diagrams/'

let server: { close: () => Promise<void> }
let browser: Browser

beforeAll(async () => {
  server = await serve(fileURLToPath(new URL('../dist', import.meta.url)), PORT)
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' })
})

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

async function open(path = PAGE, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) problems.push(m.text())
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  // The page scrolls smoothly, and a diagram hydrates when it is seen.
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto'
    document.querySelector('.idocs')?.scrollIntoView()
  })
  await page.waitForSelector('.idocs-level:not([hidden]) [data-node]')
  await page.waitForTimeout(400)
  return { page, problems, close: () => ctx.close() }
}

const ROOT = '.idocs[data-diagram="nest-shop"]'
const level = (n: number) => `.idocs[data-diagram="nest-shop"] [data-level="${n}"]`
const card = (n: number, id: string) => `${level(n)} [data-node="${id}"]`
/** The strip's two actions: show it in place, move into it. */
const strip = (n: number, id: string) => `${card(n, id)} [data-act="open"]`
const expand = (n: number, id: string) => `${card(n, id)} [data-act="expand"]`
const labels = (els: Element[]) => els.map((e) => e.getAttribute('aria-label'))
const group = (path: string) =>
  `.idocs[data-diagram="nest-shop"] [data-level="0"] [data-inline][data-node="${path}"]`
const shown = (page: Page) =>
  page.locator('.idocs-level:not([hidden])').first().getAttribute('data-level')
const hash = (page: Page) => page.evaluate(() => location.hash)
const crumbs = (page: Page) =>
  page.locator('.idocs-trail-list .idocs-crumb-label').allTextContents()

/** A card's place on screen, to tell whether a level came back the way it was left. */
const where = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
  })

/** Records the camera, and where the `orders` node is on screen, on every frame from now on. */
async function watchCamera(page: Page) {
  await page.evaluate(() => {
    const w = document.querySelector('.idocs[data-diagram="nest-shop"] .idocs-world')!
    const log: [number, number, number, number, number][] = []
    ;(window as unknown as { __cam: typeof log }).__cam = log
    const tick = () => {
      const m = /scale\(([\d.]+)\)/.exec((w as HTMLElement).style.transform)
      const r = w.querySelector('[data-node="orders"]')?.getBoundingClientRect()
      log.push([
        performance.now(),
        m ? Number(m[1]) : 0,
        w.querySelectorAll('[data-inline]').length,
        r?.left ?? Number.NaN,
        r?.top ?? Number.NaN,
      ])
      requestAnimationFrame(tick)
    }
    tick()
  })
  const mark = () => page.evaluate(() => (window as unknown as { __cam: unknown[] }).__cam.length)
  return {
    mark,
    /** What the camera did since `from`: the scales it passed through, and how far `orders` jumped when it was swapped. */
    async since(from: number) {
      const log = await page.evaluate(
        (f) => (window as unknown as { __cam: number[][] }).__cam.slice(f),
        from,
      )
      const scales = log.map((r) => r[1]!)
      let jump = 0
      for (let i = 1; i < log.length; i++) {
        const [a, b] = [log[i - 1]!, log[i]!]
        if (a[2] !== b[2] && !Number.isNaN(a[3]) && !Number.isNaN(b[3]))
          jump = Math.max(jump, Math.abs(b[3]! - a[3]!), Math.abs(b[4]! - a[4]!))
      }
      return { first: scales[0]!, last: scales.at(-1)!, max: Math.max(...scales), jump }
    },
  }
}

describe('cards that hold a diagram', () => {
  it('say so, and the others do not', async () => {
    const { page, problems, close } = await open()
    // The offscreen copies used for measuring carry the strip too; only live cards count.
    expect(await page.locator(`${level(0)} [data-node] .idocs-node-inside`).count()).toBe(2)
    expect(await page.locator(strip(0, 'orders')).count()).toBe(1)
    expect(await page.locator(strip(0, 'payments')).count()).toBe(1)
    expect(await page.locator(strip(0, 'browser')).count()).toBe(0)
    expect(await page.locator(card(0, 'orders')).getAttribute('aria-label')).toContain(
      'Holds a diagram: Order service',
    )
    expect(problems).toEqual([])
    await close()
  })

  it('are drawn like any other where the diagram has nothing to open', async () => {
    const { page, close } = await open('/examples/checkout/')
    expect(await page.locator('.idocs-node-inside').count()).toBe(0)
    expect(await page.locator('.idocs-trail').count()).toBe(0)
    await close()
  })
})

describe('looking inside and coming back', () => {
  it('opens a level with a trail, a way back and the diagram, three levels down', async () => {
    const { page, problems, close } = await open()
    expect(await page.locator('.idocs-trail').count()).toBe(0)

    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node="stock"]`)
    expect(await shown(page)).toBe('1')
    expect(await crumbs(page)).toEqual(['Online shop', 'Order service'])
    // The parent is kept, not thrown away.
    expect(await page.locator(`${level(0)}[hidden]`).count()).toBe(1)
    // Focus is on the way back, which is what Escape is scoped to.
    expect(await page.evaluate(() => document.activeElement?.className)).toContain(
      'idocs-trail-back',
    )
    // The inner diagram's own description is shown, since the page was not written for it.
    expect(
      await page
        .locator(`${level(1)} .idocs-summary`)
        .first()
        .textContent(),
    ).toContain('Inside the order service')

    await page.click(strip(1, 'stock'))
    await page.waitForSelector(`${level(2)}:not([hidden]) [data-node="warehouse"]`)
    expect(await crumbs(page)).toEqual(['Online shop', 'Order service', 'Stock'])
    expect(await hash(page)).toBe('#nest-shop~=orders/stock')
    expect(problems).toEqual([])
    await close()
  })

  it('goes up one level with Back and with Escape, and straight to any level from the trail', async () => {
    const { page, problems, close } = await open()
    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node="stock"]`)
    await page.click(strip(1, 'stock'))
    await page.waitForSelector(`${level(2)}:not([hidden]) [data-node]`)

    await page.keyboard.press('Escape')
    await page.waitForSelector(`${level(1)}:not([hidden])`)
    expect(await shown(page)).toBe('1')
    expect(await crumbs(page)).toEqual(['Online shop', 'Order service'])
    // Gone from the page too: the level, and its place in the address.
    expect(await page.locator(level(2)).count()).toBe(0)
    expect(await hash(page)).toBe('#nest-shop~=orders')

    await page.click(strip(1, 'stock'))
    await page.waitForSelector(`${level(2)}:not([hidden])`)
    await page.click('.idocs-crumb.is-link:has-text("Online shop")')
    await page.waitForSelector(`${level(0)}:not([hidden])`)
    expect(await page.locator('.idocs-trail').count()).toBe(0)
    expect(await page.locator(`${level(1)}, ${level(2)}`).count()).toBe(0)
    expect(await hash(page)).toBe('')

    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden])`)
    await page.getByRole('button', { name: 'Back to Online shop' }).click()
    await page.waitForSelector(`${level(0)}:not([hidden])`)
    expect(problems).toEqual([])
    await close()
  })

  it('leaves the parent as it was: same scenario, same step, same place on screen', async () => {
    const { page, close } = await open(`${PAGE}#nest-shop=place-order.3`)
    await page.waitForSelector('.idocs-step.is-active')
    expect(await page.locator('.idocs-step.is-active .idocs-step-n').textContent()).toBe('3')
    const before = await where(page, card(0, 'orders'))

    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node]`)
    // The inner diagram has scenarios of its own, and none of them is the parent's.
    expect(await page.locator(`${level(1)} .idocs-chip-btn`).allTextContents()).toEqual([
      'Overview',
      'Create an order',
    ])
    await page.click(`${level(1)} .idocs-chip-btn:has-text("Create an order")`)
    await page.waitForSelector(`${level(1)} .idocs-step.is-active`)
    await page.click('.idocs-trail-back')
    await page.waitForSelector(`${level(0)}:not([hidden])`)
    await page.waitForTimeout(500)

    expect(
      await page.locator(`${level(0)} .idocs-step.is-active .idocs-step-n`).textContent(),
    ).toBe('3')
    expect(
      await page.locator(`${level(0)} .idocs-chip-btn[aria-pressed="true"]`).textContent(),
    ).toBe('Place an order')
    // It was not laid out again while hidden: nothing moved.
    expect(await where(page, card(0, 'orders'))).toEqual(before)
    // And the card that was opened pulses so the eye finds it.
    expect(await page.locator(`${card(0, 'orders')}.is-origin`).count()).toBe(1)
    await close()
  })

  it('pauses what was playing in the parent while the reader is inside', async () => {
    const { page, close } = await open()
    await page.click(`${level(0)} .idocs-chip-btn:has-text("Place an order")`)
    await page.waitForSelector(`${level(0)} .idocs-packet`, { state: 'attached' })
    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node]`)
    const at = await page.locator(`${level(0)} .idocs-time`).textContent()
    await page.waitForTimeout(900)
    expect(await page.locator(`${level(0)} .idocs-time`).textContent()).toBe(at)
    await close()
  })
})

describe('the drawer', () => {
  it('offers the same way in, for the keyboard, and opens on the scenario the node names', async () => {
    const { page, problems, close } = await open()
    await page.locator(card(0, 'payments')).focus()
    await page.keyboard.press('Enter')
    const open_ = page.locator('.idocs-drawer button[aria-label="Open"]')
    await open_.waitFor()
    // The panel says what is inside, and the buttons are icons with names for the keyboard.
    expect(await page.locator('.idocs-drawer .idocs-peek-title').textContent()).toBe(
      'Payments6 nodes · 2 scenarios',
    )
    await open_.focus()
    await page.keyboard.press('Enter')

    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node="stripe"]`)
    expect(
      await page.locator(`${level(1)} .idocs-chip-btn[aria-pressed="true"]`).textContent(),
    ).toBe('Pay with a card')
    // Not playing yet: the reader decides.
    expect(await page.locator(`${level(1)} .idocs-packet`).count()).toBe(0)

    await page.keyboard.press('Escape')
    await page.waitForSelector(`${level(0)}:not([hidden])`)
    // Where they were: the drawer is still open, and the keyboard is back on the card.
    expect(await page.locator('.idocs-drawer').count()).toBe(1)
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-node'))).toBe(
      'payments',
    )
    expect(problems).toEqual([])
    await close()
  })

  it('closes first on Escape, then the next Escape goes up', async () => {
    const { page, close } = await open()
    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node="api"]`)
    await page.click(`${card(1, 'api')}`)
    await page.waitForSelector('.idocs-drawer')

    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.idocs-drawer'))
    expect(await shown(page)).toBe('1')

    await page.keyboard.press('Escape')
    await page.waitForSelector(`${level(0)}:not([hidden])`)
    await close()
  })

  it('ignores Escape while focus is in something else on the page', async () => {
    const { page, close } = await open()
    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node]`)
    await page.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'elsewhere'
      document.body.append(input)
      input.focus()
    })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    expect(await shown(page)).toBe('1')
    await close()
  })
})

describe('links', () => {
  it('open straight inside, at the scenario and step the link names', async () => {
    const { page, problems, close } = await open(
      `${PAGE}#nest-shop~=orders/stock&nest-shop/nest-orders/nest-stock=reserve.3`,
    )
    await page.waitForSelector(`${level(2)}:not([hidden]) [data-node="warehouse"]`)
    expect(await crumbs(page)).toEqual(['Online shop', 'Order service', 'Stock'])
    await page.waitForSelector(`${level(2)} .idocs-step.is-active`)
    expect(
      await page.locator(`${level(2)} .idocs-step.is-active .idocs-step-n`).textContent(),
    ).toBe('3')
    expect(problems).toEqual([])
    await close()
  })

  it('keep the scenario of each level in the address while reading', async () => {
    const { page, close } = await open()
    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node]`)
    await page.click(`${level(1)} .idocs-chip-btn:has-text("Create an order")`)
    await page.waitForFunction(() => location.hash.includes('nest-shop/nest-orders=create'))
    expect(await hash(page)).toContain('#nest-shop~=orders')
    await close()
  })

  it('ignore a path that leads nowhere', async () => {
    const { page, problems, close } = await open(`${PAGE}#nest-shop~=browser/nowhere`)
    await page.waitForTimeout(300)
    expect(await shown(page)).toBe('0')
    expect(problems).toEqual([])
    await close()
  })
})

describe('the side panel', () => {
  it('shows the diagram a node holds, as a picture, when the node is clicked', async () => {
    const { page, problems, close } = await open()
    await page.click(`${card(0, 'orders')} .idocs-node-title`)
    await page.waitForSelector('.idocs-drawer .idocs-peek-world .idocs-node')
    // Every node of the inner diagram is in the picture, which cannot be focused or clicked.
    expect(await page.locator('.idocs-peek-world .idocs-node').count()).toBe(5)
    expect(await page.locator('.idocs-peek-world .idocs-edge').count()).toBeGreaterThan(3)
    expect(
      await page.locator('.idocs-peek-world [role="button"], .idocs-peek-world [tabindex]').count(),
    ).toBe(0)
    expect(await page.locator('.idocs-peek-title').textContent()).toBe(
      'Order service5 nodes · 1 scenario',
    )
    // It fits the panel: scaled down to the width it has, not overflowing it.
    const fits = await page.evaluate(() => {
      const box = document.querySelector('.idocs-peek-box')!.getBoundingClientRect()
      const world = document.querySelector('.idocs-peek-world')!.getBoundingClientRect()
      return world.right <= box.right + 1 && world.bottom <= box.bottom + 1
    })
    expect(fits).toBe(true)

    // Another node swaps the picture; a node with nothing inside has none. The panel covers the
    // right of the canvas, so close it to reach the next card.
    await page.keyboard.press('Escape')
    await page.click(`${card(0, 'payments')} .idocs-node-title`)
    await page.waitForFunction(() =>
      document.querySelector('.idocs-peek-title')?.textContent?.startsWith('Payments'),
    )
    await page.waitForSelector('.idocs-peek-world .idocs-node')
    expect(await page.locator('.idocs-peek-world .idocs-node').count()).toBe(6)
    await page.keyboard.press('Escape')
    await page.click(`${card(0, 'browser')} .idocs-node-title`)
    await page.waitForFunction(() => !document.querySelector('.idocs-peek'))
    expect(problems).toEqual([])
    await close()
  })

  it('has the two ways in as icon buttons, beside the picture', async () => {
    const { page, close } = await open()
    await page.click(`${card(0, 'orders')} .idocs-node-title`)
    const buttons = page.locator('.idocs-peek-head button')
    expect(await buttons.evaluateAll(labels)).toEqual(['Expand here', 'Open'])
    // Icons only: no words on them, and a tooltip for the pointer.
    expect(await buttons.allTextContents()).toEqual(['', ''])
    expect(await buttons.first().getAttribute('title')).toContain('Expand')

    await buttons.first().click()
    await page.waitForSelector(group('orders'))
    // Expanded, the thing itself is on the canvas: the panel keeps the buttons and drops the picture.
    expect(await page.locator('.idocs-peek-world').count()).toBe(0)
    expect(await page.locator('.idocs-peek-head button').evaluateAll(labels)).toEqual([
      'Collapse',
      'Open',
    ])

    await page.locator('.idocs-peek-head button[aria-label="Open"]').click()
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node="stock"]`)
    await close()
  })

  it('shows it for a node inside a group too', async () => {
    const { page, close } = await open()
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    await page.click(`${card(0, 'orders/stock')} .idocs-node-title`)
    await page.waitForSelector('.idocs-drawer .idocs-peek-world .idocs-node')
    expect(await page.locator('.idocs-peek-world .idocs-node').count()).toBe(3)
    expect(await page.locator('.idocs-peek-title').textContent()).toContain('Stock reservations')
    await close()
  })

  it('draws the card strip and the group header with icons only', async () => {
    const { page, close } = await open()
    expect(await page.locator(`${card(0, 'orders')} [data-act]`).allTextContents()).toEqual([
      '',
      '',
    ])
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    const head = page.locator(`${group('orders')} > .idocs-inline-head button.idocs-inline-act`)
    expect(await head.allTextContents()).toEqual(['', ''])
    expect(await head.evaluateAll(labels)).toEqual(['Collapse Order service', 'Open Order service'])
    await close()
  })
})

describe('expanding in place', () => {
  const frames = (page: Page) =>
    page
      .locator('.idocs[data-diagram="nest-shop"] [data-level="0"] [data-inline]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-node')))

  it('turns a card into a group holding the whole inner diagram, and folds it back', async () => {
    const { page, problems, close } = await open()
    const before = await where(page, card(0, 'orders'))
    expect(await page.locator(expand(0, 'orders')).count()).toBe(1)

    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    expect(await page.locator(card(0, 'orders')).count()).toBe(1)
    expect(
      await page
        .locator(`${group('orders')} .idocs-node-title`)
        .first()
        .textContent(),
    ).toBe('Order service')
    for (const id of ['api', 'rules', 'stock', 'db', 'outbox']) {
      expect(await page.locator(card(0, `orders/${id}`)).count(), id).toBe(1)
    }
    await page.waitForTimeout(500)
    const grown = await where(page, group('orders'))
    expect(grown[2]).toBeGreaterThan(before[2]! * 2)

    // Nothing else sits under it, and nothing is faded just because the pointer was on the card.
    const rects = await page
      .locator(
        '.idocs[data-diagram="nest-shop"] [data-level="0"] .idocs-world > .idocs-node, .idocs[data-diagram="nest-shop"] [data-level="0"] .idocs-world > .idocs-inline',
      )
      .evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect()
          return [r.left, r.top, r.right, r.bottom]
        }),
      )
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i]!, rects[j]!]
        expect(a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!).toBe(false)
      }
    }
    expect(
      await page.locator('.idocs[data-diagram="nest-shop"] [data-level="0"] .is-dim').count(),
    ).toBe(0)

    await page.getByRole('button', { name: 'Collapse Order service' }).click()
    await page.waitForSelector(`${card(0, 'orders')}:not([data-inline])`)
    expect(await frames(page)).toEqual([])
    expect(problems).toEqual([])
    await close()
  })

  it('moves the camera once and smoothly: folding eases out to the whole diagram', async () => {
    const { page, problems, close } = await open()
    const cam = await watchCamera(page)
    const frameFit = async () => {
      // What "Fit to view" would show: the camera should end exactly there after a fold.
      await page.locator(`${ROOT} [aria-label="Fit to view"]`).click()
      await page.waitForTimeout(100)
      return cam.since(await cam.mark().then((n) => n - 1))
    }

    let from = await cam.mark()
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    await page.waitForTimeout(1200)
    const grew = await cam.since(from)
    // Showing keeps the card where it was for the first frame, then carries on from there.
    expect(grew.jump).toBeLessThan(12)

    from = await cam.mark()
    await page.getByRole('button', { name: 'Collapse Order service' }).click()
    await page.waitForTimeout(1500)
    const folded = await cam.since(from)
    // No jump when the layout is swapped, and never a zoom in on the card that is left.
    expect(folded.jump).toBeLessThan(12)
    expect(folded.max).toBeLessThanOrEqual(Math.max(folded.first, folded.last) + 0.01)
    // It ends on the whole diagram, with every top-level card in the frame.
    const frame = (await page.locator(`${ROOT} .idocs-frame`).boundingBox())!
    const cards = await page.locator(`${level(0)} .idocs-world > .idocs-node`).evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return [r.left, r.top, r.right, r.bottom]
      }),
    )
    for (const [l, t, r, b] of cards) {
      expect(l).toBeGreaterThanOrEqual(frame.x - 1)
      expect(r).toBeLessThanOrEqual(frame.x + frame.width + 1)
      expect(t).toBeGreaterThanOrEqual(frame.y - 1)
      expect(b).toBeLessThanOrEqual(frame.y + frame.height + 1)
    }
    const settled = (await frameFit()).last
    expect(Math.abs(settled - folded.last)).toBeLessThan(0.01)
    expect(problems).toEqual([])
    await close()
  })

  it('folds an inner node back to the group around it, not to the card', async () => {
    const { page, close } = await open()
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    await page.click(expand(0, 'orders/stock'))
    await page.waitForSelector(group('orders/stock'))
    await page.waitForTimeout(1300)
    const cam = await watchCamera(page)
    const from = await cam.mark()
    await page.click(
      `${group('orders/stock')} > .idocs-inline-head button[aria-label="Collapse Stock"]`,
    )
    await page.waitForSelector(`${card(0, 'orders/stock')}:not([data-inline])`)
    await page.waitForTimeout(1500)
    const folded = await cam.since(from)
    expect(folded.jump).toBeLessThan(12)
    // Zooms out to the group, never in on the single card.
    expect(folded.last).toBeLessThanOrEqual(folded.first + 0.01)
    await close()
  })

  it('goes as deep as the diagrams do', async () => {
    const { page, close } = await open()
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    await page.click(expand(0, 'orders/stock'))
    await page.waitForSelector(group('orders/stock'))
    expect(await frames(page)).toEqual(['orders', 'orders/stock'])
    expect(await page.locator(card(0, 'orders/stock/warehouse')).count()).toBe(1)
    // Folding the outer one keeps what was open inside it for next time. The camera is on the
    // inner group, so the outer header is outside the frame: use the drawer.
    await page
      .locator(`${card(0, 'orders')} > .idocs-inline-head .idocs-inline-title`)
      .evaluate((el) => (el as HTMLElement).click())
    await page.locator('.idocs-drawer button[aria-label="Collapse"]').click()
    await page.waitForSelector(`${card(0, 'orders')}:not([data-inline])`)
    // The panel stays on the node, over the right of the canvas: close it to reach the card.
    await page.keyboard.press('Escape')
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders/stock'))
    await close()
  })

  it('opens the drawer for a node inside a group, with its own connections', async () => {
    const { page, close } = await open()
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    await page.click(card(0, 'orders/api'))
    await page.waitForSelector('.idocs-drawer')
    expect(await page.locator('.idocs-drawer .idocs-node-title').textContent()).toBe('Orders API')
    expect(await page.locator('.idocs-drawer-links li').count()).toBe(4)
    // Its neighbours in the inner diagram light up; the outer diagram is left alone.
    expect(
      await page
        .locator(
          '.idocs[data-diagram="nest-shop"] [data-level="0"] .idocs-world > .idocs-node.is-dim',
        )
        .count(),
    ).toBe(0)

    await page.keyboard.press('Escape')
    await page.click(`${group('orders')} .idocs-inline-title`)
    await page.waitForSelector('.idocs-drawer')
    expect(await page.locator('.idocs-peek-head button').evaluateAll(labels)).toEqual([
      'Collapse',
      'Open',
    ])
    await close()
  })

  it('offers both ways in the drawer, and folds from there', async () => {
    const { page, close } = await open()
    await page.locator(card(0, 'orders')).focus()
    await page.keyboard.press('Enter')
    expect(await page.locator('.idocs-peek-head button').evaluateAll(labels)).toEqual([
      'Expand here',
      'Open',
    ])
    await page.locator('.idocs-drawer button[aria-label="Expand here"]').click()
    await page.waitForSelector(group('orders'))
    await close()
  })

  it('starts expanded when the author said so, and offers only what the author allowed', async () => {
    const { page, problems, close } = await open()
    await page.locator('.idocs').nth(1).scrollIntoViewIfNeeded()
    const second = page.locator('.idocs[data-diagram="nest-inline"]')
    await second.locator('[data-node="stock"][data-inline]').waitFor()
    expect(await second.locator('[data-node="stock/api"]').count()).toBe(1)
    // Open only: no way to expand, so the strip has the one icon.
    expect(
      await second
        .locator('[data-node="reports"] [data-act]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-act'))),
    ).toEqual(['open'])
    expect(await second.locator('.idocs-drawer').count()).toBe(0)
    expect(problems).toEqual([])
    await close()
  })

  it('keeps what is expanded in the link, and restores it', async () => {
    const { page, close } = await open()
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    await page.waitForFunction(() => location.hash.includes('nest-shop+=orders'))
    await page.getByRole('button', { name: 'Collapse Order service' }).click()
    await page.waitForFunction(() => !location.hash.includes('nest-shop+'))
    await close()

    const again = await open(`${PAGE}#nest-shop+=orders,orders/stock`)
    await again.page.waitForSelector(group('orders/stock'))
    expect(await frames(again.page)).toEqual(['orders', 'orders/stock'])
    await again.close()

    // `none` is how a link says "fold what the author expanded".
    const none = await open(`${PAGE}#nest-inline+=none`)
    await none.page.locator('.idocs').nth(1).scrollIntoViewIfNeeded()
    await none.page.waitForSelector('.idocs[data-diagram="nest-inline"] [data-node="stock"]')
    expect(
      await none.page.locator('.idocs[data-diagram="nest-inline"] [data-inline]').count(),
    ).toBe(0)
    await none.close()
  })

  it('opens a node from inside a group, with every level on the way in the trail', async () => {
    const { page, problems, close } = await open(`${PAGE}#nest-shop=place-order.3`)
    await page.waitForSelector('.idocs-step.is-active')
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    await page.click(strip(0, 'orders/stock'))
    await page.waitForSelector(`${level(2)}:not([hidden]) [data-node="warehouse"]`)
    expect(await crumbs(page)).toEqual(['Online shop', 'Order service', 'Stock'])
    expect(await hash(page)).toContain('nest-shop~=orders/stock')

    await page.click('.idocs-trail-back')
    await page.waitForSelector(`${level(1)}:not([hidden])`)
    await page.click('.idocs-trail-back')
    await page.waitForSelector(`${level(0)}:not([hidden])`)
    // The parent is as it was left: the group is still open, and so is the scenario.
    expect(await page.locator(group('orders')).count()).toBe(1)
    expect(
      await page.locator(`${level(0)} .idocs-step.is-active .idocs-step-n`).textContent(),
    ).toBe('3')
    expect(problems).toEqual([])
    await close()
  })

  it('keeps the outer scenario working with a node expanded: the packets arrive at the group', async () => {
    const { page, close } = await open()
    await page.click(expand(0, 'orders'))
    await page.waitForSelector(group('orders'))
    await page.click(`${level(0)} .idocs-chip-btn:has-text("Place an order")`)
    await page.waitForSelector(`${level(0)} .idocs-packet`, { state: 'attached' })
    await page.waitForFunction(
      () =>
        document
          .querySelector(
            '.idocs[data-diagram="nest-shop"] [data-level="0"] [data-inline][data-node="orders"]',
          )
          ?.classList.contains('is-visited'),
      null,
      { timeout: 20_000 },
    )
    await close()
  })
})

describe('drawing', () => {
  it('stays sharp at rest on every level: nothing keeps the zoomed layer on the GPU', async () => {
    const { page, close } = await open()
    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node]`)
    await page.waitForTimeout(700)
    const willChange = await page.locator(`${level(1)} .idocs-world`).evaluate((el) => {
      return getComputedStyle(el).willChange
    })
    expect(willChange).toBe('auto')
    const animated = await page
      .locator(`${level(1)}`)
      .evaluate((el) => getComputedStyle(el).animationName)
    expect(animated).toBe('none')
    await close()
  })

  it('keeps the trail and the whole level in full screen, and can go deeper and back there', async () => {
    const { page, problems, close } = await open()
    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node]`)
    await page.getByRole('button', { name: 'Full screen' }).click()
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('idocs'))

    const fills = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect()
      const trail = box('.idocs-trail')
      const frame = box('.idocs-level:not([hidden]) .idocs-frame')
      return { trailTop: trail.top, frameBottom: frame.bottom, screen: innerHeight }
    })
    expect(fills.trailTop).toBeLessThan(40)
    expect(fills.frameBottom).toBeGreaterThan(fills.screen * 0.9)

    await page.click(strip(1, 'stock'))
    await page.waitForSelector(`${level(2)}:not([hidden]) [data-node]`)
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true)
    await page.click('.idocs-trail-back')
    await page.waitForSelector(`${level(1)}:not([hidden])`)
    expect(problems).toEqual([])
    await close()
  })

  it('does not scroll sideways on a phone, three levels down', async () => {
    const { page, close } = await open(PAGE, 390)
    await page.click(strip(0, 'orders'))
    await page.waitForSelector(`${level(1)}:not([hidden]) [data-node]`)
    await page.click(strip(1, 'stock'))
    await page.waitForSelector(`${level(2)}:not([hidden]) [data-node]`)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await close()
  })
})
