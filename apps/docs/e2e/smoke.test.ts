import { fileURLToPath } from 'node:url'
import { type Browser, chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'
import { chosen, openSteps, pick, pickView, stepNow, waitForStep } from './panel'

const PORT = 4501
const BASE = `http://localhost:${PORT}`

let server: { close: () => Promise<void> }
let browser: Browser

beforeAll(async () => {
  // The built docs site; `pnpm test:e2e` builds it first.
  server = await serve(fileURLToPath(new URL('../dist', import.meta.url)), PORT)
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' })
})

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

async function open(path: string, opts: { theme?: 'light' | 'dark' } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    colorScheme: opts.theme ?? 'light',
  })
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) problems.push(m.text())
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.idocs-node')
  await page.waitForTimeout(500)
  return { page, problems, close: () => ctx.close() }
}

describe('checkout example', () => {
  it('renders every node with an icon, edges and a legend', async () => {
    const { page, problems, close } = await open('/examples/checkout/')
    expect(await page.locator('[data-node]').count()).toBe(12)
    expect(await page.locator('[data-node] .idocs-icon svg').count()).toBe(12)
    expect(await page.locator('.idocs-edge').count()).toBeGreaterThan(10)
    expect(await page.locator('.idocs-legend span').count()).toBeGreaterThan(2)
    expect(problems).toEqual([])
    await close()
  })

  it('plays a scenario: packets fly, the step list follows, the hash is shareable', async () => {
    const { page, problems, close } = await open('/examples/checkout/')
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-packet', { state: 'attached', timeout: 5000 })
    await waitForStep(page)
    await page.waitForFunction(
      () => document.querySelector('.idocs-btn.is-primary')?.textContent?.includes('Replay'),
      null,
      { timeout: 40_000 },
    )
    await openSteps(page)
    expect(await page.locator('.idocs-step.is-done').count()).toBeGreaterThan(5)
    expect(await page.evaluate(() => location.hash)).toMatch(/^#checkout=place-order\.\d+$/)
    expect(problems).toEqual([])
    await close()
  })

  it('steps with next and previous, and jumps by clicking a step', async () => {
    const { page, close } = await open('/examples/checkout/')
    await pick(page, 'Browse a product (cache hit)')
    await page.click('.idocs-btn.is-primary') // pause
    await page.waitForTimeout(150)
    // Paused mid-step: the first Next finishes that step, the second plays the one after it.
    const resumed = () =>
      page.waitForFunction(
        () => document.querySelector('.idocs-btn.is-primary')?.textContent?.includes('Resume'),
        null,
        { timeout: 8000 },
      )
    await page.click('button[aria-label="Next step"]')
    await resumed()
    await page.click('button[aria-label="Next step"]')
    await resumed()
    expect(await stepNow(page)).toBeGreaterThanOrEqual(2)
    await openSteps(page)
    await page.click('.idocs-step:nth-of-type(1)')
    await page.waitForTimeout(300)
    await page.click('.idocs-btn.is-primary')
    await close()
  })

  it('shows the sequence view for the same scenario', async () => {
    const { page, close } = await open('/examples/checkout/')
    await pick(page, 'Card declined')
    await page.click('.idocs-modes button:has-text("Sequence")')
    await page.waitForSelector('.idocs-seq svg')
    const rows = await page.locator('.idocs-seq .seq-row').count()
    await openSteps(page)
    const steps = await page.locator('.idocs-step').count()
    expect(rows).toBe(steps)
    await close()
  })

  it('opens a drawer with the markdown doc and closes it with Escape', async () => {
    const { page, close } = await open('/examples/checkout/')
    await page.click('[data-node="orders"]')
    const drawer = page.locator('.idocs-drawer')
    await drawer.waitFor()
    expect(await drawer.locator('table').count()).toBe(1)
    expect(await drawer.locator('pre').count()).toBe(1)
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'detached' })
    await close()
  })

  it('opens the drawer from the keyboard', async () => {
    const { page, close } = await open('/examples/checkout/')
    await page.focus('[data-node="gateway"]')
    await page.keyboard.press('Enter')
    await page.locator('.idocs-drawer').waitFor()
    expect(await page.locator('.idocs-drawer').textContent()).toContain('rate limit')
    await close()
  })

  it('restores a scenario and step from the URL', async () => {
    const { page, close } = await open('/examples/checkout/#checkout=place-order.3')
    await waitForStep(page)
    expect(await stepNow(page)).toBe(3)
    expect(await chosen(page)).toBe('Place an order')
    await close()
  })

  it('switches views from the tabs', async () => {
    const { page, close } = await open('/examples/checkout/')
    const before = await page.locator('[data-node]').count()
    await pickView(page, 'Backend only')
    await page.waitForFunction((n) => document.querySelectorAll('[data-node]').length < n, before)
    await close()
  })

  it('toggles planned items', async () => {
    const { page, close } = await open('/examples/checkout/')
    await page.click('.idocs-tool:has-text("Hide planned")')
    expect(await page.locator('[data-node].is-hidden').count()).toBe(1)
    await close()
  })

  it('themes with the site: dark mode changes the surface colour', async () => {
    const light = await open('/examples/checkout/')
    const lightBg = await light.page.evaluate(
      () => getComputedStyle(document.querySelector('[data-node]')!).backgroundColor,
    )
    await light.close()
    const dark = await open('/examples/checkout/', { theme: 'dark' })
    await dark.page.evaluate(() => localStorage.setItem('starlight-theme', 'dark'))
    await dark.page.reload({ waitUntil: 'networkidle' })
    await dark.page.waitForSelector('.idocs-node')
    const darkBg = await dark.page.evaluate(
      () => getComputedStyle(document.querySelector('[data-node]')!).backgroundColor,
    )
    expect(darkBg).not.toBe(lightBg)
    await dark.close()
  })
})

describe('story view', () => {
  it('opens a scenario written with mode: story as swimlanes, grouped into the lanes it declares', async () => {
    const { page, problems, close } = await open('/examples/platform/')
    await pick(page, 'One read request')
    await page.waitForSelector('.idocs-story-grid')
    expect(await page.locator('.idocs-lane-head').count()).toBe(8)
    expect(await page.locator('.idocs-phase-label').count()).toBe(5)
    expect(await page.locator('.idocs-sbox.role-lookup').count()).toBe(6)
    expect(await page.locator('.idocs-sbox:not(.role-lookup)').count()).toBe(13)
    // The story in one breath is at the top of the list of steps.
    await openSteps(page)
    expect(await page.locator('.idocs-panel-summary').count()).toBe(1)
    // Connectors are measured from the real boxes, so they exist only once layout has settled.
    await page.waitForSelector('.idocs-slink')
    expect(await page.locator('.idocs-slink').count()).toBe(18)
    expect(problems).toEqual([])
    await close()
  })

  it('shows any scenario as a story, with lanes taken from the nodes involved', async () => {
    const { page, close } = await open('/examples/checkout/')
    await pick(page, 'Place an order')
    await page.click('.idocs-modes button:has-text("Story")')
    await page.waitForSelector('.idocs-story-grid')
    expect(await page.locator('.idocs-lane-head').count()).toBe(6)
    expect(await page.locator('.idocs-sbox.st-planned').count()).toBe(1)
    await page.click('.idocs-modes button:has-text("Flow")')
    await page.waitForSelector('[data-node]')
    await close()
  })

  it('plays the clicked step and keeps the step list in step', async () => {
    const { page, close } = await open('/examples/checkout/')
    await pick(page, 'Place an order')
    await page.click('.idocs-modes button:has-text("Story")')
    await page.waitForSelector('.idocs-story-grid')
    await page.click('.idocs-sbox:has-text("create payment intent")')
    await page.waitForSelector('.idocs-sbox.is-active')
    expect(await stepNow(page)).toBe(3)
    await close()
  })
})

describe('zoom', () => {
  it('does not leave the diagram on a promoted layer once zooming stops, which would blur it', async () => {
    const { page, close } = await open('/examples/checkout/')
    for (let i = 0; i < 3; i++) await page.click('button[aria-label="Zoom in"]')
    await page.waitForTimeout(500)
    const willChange = await page
      .locator('.idocs-world')
      .evaluate((el) => getComputedStyle(el).willChange)
    expect(willChange).toBe('auto')
    await close()
  })
})

describe('platform example', () => {
  it('renders the large diagram and plays a scenario to the end', async () => {
    const { page, problems, close } = await open('/examples/platform/')
    expect(await page.locator('[data-node]').count()).toBe(37)
    expect(await page.locator('.idocs-zone').count()).toBe(9)
    await pick(page, 'Dispatch a job to a device')
    await page.selectOption('.idocs-bar select', '2')
    await page.waitForFunction(
      () => document.querySelector('.idocs-btn.is-primary')?.textContent?.includes('Replay'),
      null,
      { timeout: 50_000 },
    )
    expect(problems).toEqual([])
    await close()
  })

  it('keeps the camera on the action when the diagram is large', async () => {
    const { page, close } = await open('/examples/platform/')
    const before = await page
      .locator('.idocs-world')
      .evaluate((el) => (el as HTMLElement).style.transform)
    await pick(page, 'Device is offline')
    await page.waitForTimeout(2500)
    const during = await page
      .locator('.idocs-world')
      .evaluate((el) => (el as HTMLElement).style.transform)
    expect(during).not.toBe(before)
    expect(await page.locator('.idocs-tool:has-text("Follow")').getAttribute('aria-pressed')).toBe(
      'true',
    )
    await close()
  })
})

describe('entity cards', () => {
  it('draws a row per field, marks keys and references, and draws a relation for each ref', async () => {
    const { page, problems, close } = await open('/format/entities/')
    expect(await page.locator('[data-node]').count()).toBe(7)
    const orders = page.locator('[data-node="orders"]')
    expect(await orders.locator('.idocs-field').count()).toBe(6)
    expect(await orders.locator('.idocs-pill.is-tag').textContent()).toBe('TABLE')
    expect(await orders.locator('.idocs-field.is-key .idocs-field-name').textContent()).toContain(
      'id',
    )
    expect(await orders.locator('.idocs-field.is-ref').count()).toBe(2)
    // Seven relations: five refs and two written by hand, one of which replaces a ref.
    expect(await page.locator('.idocs-edge').count()).toBe(7)
    expect(await page.locator('.idocs-legend').textContent()).toContain('Relation between entities')
    expect(problems).toEqual([])
    await close()
  })

  it('lists the fields and what each connection is about in the drawer', async () => {
    const { page, close } = await open('/format/entities/')
    await page.click('[data-node="order_items"]')
    const drawer = page.locator('.idocs-drawer')
    await drawer.waitFor()
    expect(await drawer.locator('.idocs-drawer-fields li').count()).toBe(4)
    // A reference is a way to the entity it points at.
    await drawer.locator('.idocs-drawer-ref button', { hasText: 'orders.id' }).click()
    await page.waitForSelector('.idocs-drawer .idocs-node-title:has-text("orders")')
    expect(await drawer.locator('.idocs-drawer-links').textContent()).toContain('id ← order_id')
    await close()
  })

  it('keeps the card as wide as the model says, and the rows inside it', async () => {
    const { page, close } = await open('/format/entities/')
    const card = page.locator('[data-node="orders"]')
    const box = (await card.boundingBox())!
    for (const row of await card.locator('.idocs-field').all()) {
      const r = (await row.boundingBox())!
      expect(r.x).toBeGreaterThanOrEqual(box.x - 1)
      expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 1)
      expect(r.y + r.height).toBeLessThanOrEqual(box.y + box.height + 1)
    }
    await close()
  })
})
