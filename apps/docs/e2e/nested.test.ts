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

const level = (n: number) => `[data-level="${n}"]`
const card = (n: number, id: string) => `${level(n)} [data-node="${id}"]`
const strip = (n: number, id: string) => `${card(n, id)} .idocs-node-inside`
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
    const open_ = page.locator('.idocs-drawer .idocs-open')
    await open_.waitFor()
    expect(await open_.textContent()).toContain('Payments: 6 nodes, 2 scenarios')
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
