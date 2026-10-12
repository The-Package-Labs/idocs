import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'
import {
  chosen,
  closeSteps,
  openSteps,
  pick,
  pickView,
  scenarioTitles,
  stepNow,
  waitForStep,
} from './panel'

const PORT = 4507
const BASE = `http://localhost:${PORT}`

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

async function open(path = '/examples/checkout/', width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) problems.push(m.text())
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto'
  })
  await page.waitForSelector('.idocs-panel')
  await page.waitForSelector('[data-node]')
  await page.locator('.idocs-frame').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  return { page, problems, close: () => ctx.close() }
}

const box = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }
    })

/** The left edge of the leftmost card, which is where the picture starts. */
const pictureLeft = (page: Page) =>
  page.evaluate(() =>
    Math.min(
      ...[...document.querySelectorAll('.idocs-frame [data-node]')].map(
        (n) => n.getBoundingClientRect().x,
      ),
    ),
  )

const tabs = (page: Page) => page.locator('.idocs-panel-tab').allTextContents()
const selectedTab = (page: Page) =>
  page.locator('.idocs-panel-tab[aria-selected="true"]').textContent()

describe('the panel', () => {
  it('floats inside the viewport, over the left of the picture, with the outline and the views as tabs', async () => {
    const { page, problems, close } = await open()
    const panel = await box(page, '.idocs-panel')
    const frame = await box(page, '.idocs-frame')
    // Inside the frame the picture is drawn in, not beside it.
    expect(await page.locator('.idocs-frame > .idocs-panel').count()).toBe(1)
    expect(panel.x).toBeGreaterThanOrEqual(frame.x)
    expect(panel.right).toBeLessThan(frame.right - 300)
    expect(panel.y).toBeGreaterThanOrEqual(frame.y)
    expect(panel.bottom).toBeLessThanOrEqual(frame.bottom)
    // The views are what it has to choose from, so they are what it opens on. Scenarios are not
    // here at all: they are on the bar under the picture.
    expect(await tabs(page)).toEqual(['Outline', 'Views'])
    expect(await selectedTab(page)).toBe('Views')

    // Choosing a scenario leaves the panel as it was.
    await pick(page, 'Place an order')
    expect(await tabs(page)).toEqual(['Outline', 'Views'])
    expect(await selectedTab(page)).toBe('Views')
    expect(await chosen(page)).toBe('Place an order')
    expect(problems).toEqual([])
    await close()
  })

  it('fits the picture to what the panel leaves, so nothing starts underneath it', async () => {
    const { page, close } = await open()
    const panel = await box(page, '.idocs-panel')
    expect(await pictureLeft(page)).toBeGreaterThanOrEqual(panel.right - 1)
    await close()
  })

  it('does not take part in panning and zooming the picture', async () => {
    const { page, close } = await open()
    const before = await page
      .locator('.idocs-world')
      .evaluate((e) => (e as HTMLElement).style.transform)
    const panel = await box(page, '.idocs-panel')
    await page.mouse.move(panel.x + panel.w / 2, panel.y + panel.h / 2)
    await page.mouse.down()
    await page.mouse.move(panel.x + panel.w / 2 + 120, panel.y + panel.h / 2 + 60, { steps: 4 })
    await page.mouse.up()
    expect(
      await page.locator('.idocs-world').evaluate((e) => (e as HTMLElement).style.transform),
    ).toBe(before)
    await close()
  })

  it('moves between the tabs with the arrow keys', async () => {
    const { page, close } = await open()
    await page.locator('.idocs-panel-tab[aria-selected="true"]').focus()
    await page.keyboard.press('ArrowLeft')
    expect(await selectedTab(page)).toBe('Outline')
    await page.keyboard.press('ArrowRight')
    expect(await selectedTab(page)).toBe('Views')
    await close()
  })

  it('keeps the tabs where they are, whatever is chosen, so a click never lands on the wrong one', async () => {
    const { page, close } = await open()
    const places = () =>
      page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll('.idocs-panel-tab')].map((t) => [
            t.textContent,
            Math.round(t.getBoundingClientRect().x),
          ]),
        ),
      )
    const before = await places()
    await pick(page, 'Place an order')
    expect(await places()).toEqual(before)
    await pickView(page, 'Backend only')
    await page.waitForFunction(() => !document.querySelector('.idocs-bar'))
    expect(await places()).toEqual(before)
    await close()
  })

  it('lists the views, and switching one shows its own scenarios on the bar', async () => {
    const { page, close } = await open()
    const before = await page.locator('[data-node]').count()
    await pickView(page, 'Backend only')
    await page.waitForFunction((n) => document.querySelectorAll('[data-node]').length < n, before)
    // The panel stays on the views; this one has no scenarios, so the bar has nothing to offer.
    expect(await selectedTab(page)).toBe('Views')
    expect(await page.locator('.idocs-bar').count()).toBe(0)
    await pickView(page, 'Overview')
    await page.waitForSelector('.idocs-bar')
    expect(await scenarioTitles(page)).toEqual([
      'Overview',
      'Browse a product (cache hit)',
      'Browse a product (cache miss)',
      'Place an order',
      'Card declined',
    ])
    await close()
  })
})

describe('the outline', () => {
  const rows = (page: Page, kind: string) => page.locator(`.idocs-ol-row.is-${kind}`)
  const row = (page: Page, title: string) =>
    page
      .locator('.idocs-ol-row.is-node')
      .filter({ has: page.locator('.idocs-ol-title', { hasText: new RegExp(`^${title}$`) }) })

  async function outline(page: Page) {
    await page.locator('.idocs-panel-tab', { hasText: 'Outline' }).click()
    await page.waitForSelector('.idocs-ol-row')
  }

  it('is a tree: groups hold their nodes, and each node lists what it connects to', async () => {
    const { page, close } = await open()
    await outline(page)
    expect(await page.locator('.idocs-ol-count').textContent()).toBe('12 nodes · 13 connections')
    expect(await rows(page, 'group').count()).toBe(3)
    expect(await rows(page, 'node').count()).toBe(12)
    // Every connection shows at both of its ends.
    expect(await rows(page, 'edge').count()).toBe(26)
    // In the order the author wrote them: the browser comes first, before the groups.
    expect(await page.locator('.idocs-ol-row.is-node .idocs-ol-title').first().textContent()).toBe(
      'Shopper browser',
    )
    // Nested groups sit deeper than the group that holds them.
    const level = (title: string) =>
      page.locator('.idocs-ol-row.is-group', { hasText: title }).first().getAttribute('aria-level')
    expect(Number(await level('Data and messaging'))).toBeGreaterThan(
      Number(await level('Backend')),
    )
    await close()
  })

  it('selects a node: its details open and the picture brings it between the panel and the drawer', async () => {
    const { page, problems, close } = await open()
    await outline(page)
    await row(page, 'order-service').click()
    await page.waitForSelector('.idocs-drawer')
    expect(await page.locator('.idocs-drawer .idocs-node-title').textContent()).toBe(
      'order-service',
    )
    expect(await row(page, 'order-service').getAttribute('aria-selected')).toBe('true')
    await page.waitForTimeout(900)
    const card = await box(page, '[data-node="orders"]')
    const panel = await box(page, '.idocs-panel')
    const drawer = await box(page, '.idocs-drawer')
    expect(card.x).toBeGreaterThanOrEqual(panel.right - 1)
    expect(card.right).toBeLessThanOrEqual(drawer.x + 1)
    expect(await page.locator('[data-node="orders"].is-selected').count()).toBe(1)
    // Choosing it again keeps it chosen: the outline selects, a card toggles.
    await row(page, 'order-service').click()
    expect(await page.locator('.idocs-drawer').count()).toBe(1)
    expect(problems).toEqual([])
    await close()
  })

  it('goes to the node at the other end of a connection', async () => {
    const { page, close } = await open()
    await outline(page)
    await row(page, 'API gateway').click()
    await page.waitForSelector('.idocs-drawer')
    await page
      .locator('.idocs-ol-row.is-edge', { hasText: 'order-service' })
      .filter({ hasText: '/orders' })
      .first()
      .click()
    await page.waitForFunction(
      () =>
        document.querySelector('.idocs-drawer .idocs-node-title')?.textContent === 'order-service',
    )
    await close()
  })

  it('lights up the node in the picture while the pointer is on its row, and the row for the node under the pointer', async () => {
    const { page, close } = await open()
    await outline(page)
    await row(page, 'catalog-service').hover()
    await page.waitForSelector('[data-node="catalog"].is-hl')
    expect(await page.locator('[data-node="cart"].is-dim').count()).toBe(1)
    await page.mouse.move(5, 5)
    await page.waitForFunction(() => !document.querySelector('.idocs-frame .is-dim'))
    // And the other way round.
    await page.hover('[data-node="cart"]')
    await page.waitForSelector('.idocs-ol-row.is-hovered')
    expect(await page.locator('.idocs-ol-row.is-hovered .idocs-ol-title').textContent()).toBe(
      'cart-service',
    )
    await close()
  })

  it('folds groups and connections away, one at a time or all at once', async () => {
    const { page, close } = await open()
    await outline(page)
    const all = await page.locator('.idocs-ol-row').count()
    await page.locator('.idocs-ol-row.is-group', { hasText: 'Edge' }).first().click()
    expect(await page.locator('.idocs-ol-row').count()).toBeLessThan(all)
    expect(
      await page
        .locator('.idocs-ol-row.is-group', { hasText: 'Edge' })
        .first()
        .getAttribute('aria-expanded'),
    ).toBe('false')
    await page.getByRole('button', { name: 'Fold everything', exact: true }).click()
    // Only the top level is left: the groups and the nodes that belong to none.
    expect(await page.locator('.idocs-ol-row').count()).toBeLessThan(8)
    await page.getByRole('button', { name: 'Unfold everything', exact: true }).click()
    expect(await page.locator('.idocs-ol-row').count()).toBe(all)
    await close()
  })

  it('is reachable from the keyboard', async () => {
    const { page, close } = await open()
    await outline(page)
    await page.locator('.idocs-ol-row').first().focus()
    await page.keyboard.press('ArrowDown')
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-row'))).not.toBe(
      await page.locator('.idocs-ol-row').first().getAttribute('data-row'),
    )
    // Left folds a group, right opens it again.
    await page.locator('.idocs-ol-row.is-group').first().focus()
    await page.keyboard.press('ArrowLeft')
    expect(await page.locator('.idocs-ol-row.is-group').first().getAttribute('aria-expanded')).toBe(
      'false',
    )
    await page.keyboard.press('ArrowRight')
    expect(await page.locator('.idocs-ol-row.is-group').first().getAttribute('aria-expanded')).toBe(
      'true',
    )
    // Enter chooses a node.
    await row(page, 'order-service').focus()
    await page.keyboard.press('Enter')
    await page.waitForSelector('.idocs-drawer')
    await close()
  })

  it('shows what a node holds, and the nodes of a diagram shown in place', async () => {
    const { page, problems, close } = await open('/format/nested-diagrams/')
    await page.waitForSelector('.idocs-panel')
    // This diagram has one view, so its panel starts folded: open it.
    await page.getByRole('button', { name: 'Show the panel' }).first().click()
    await page.locator('.idocs-panel-tab', { hasText: 'Outline' }).first().click()
    const orders = row(page, 'Order service').first()
    await orders.hover()
    const before = await page.locator('.idocs-ol-row.is-node').count()
    await orders.locator('[data-act="expand"]').click()
    await page.waitForSelector('.idocs-inline-title, [data-inline]')
    await page.waitForFunction(
      (n) => document.querySelectorAll('.idocs-ol-row.is-node').length > n,
      before,
    )
    // The nodes inside are rows of their own, under the node that holds them.
    const inner = page.locator('.idocs-ol-row.is-node[data-row^="orders/"]')
    expect(await inner.count()).toBeGreaterThan(0)
    await inner.first().click()
    await page.waitForSelector('.idocs-drawer')
    expect(problems).toEqual([])
    await close()
  })
})

describe('the bar under the picture', () => {
  it('is the bottom edge of the viewport: as wide as the picture and attached to it', async () => {
    const { page, close } = await open()
    const frame = await box(page, '.idocs-frame')
    const bar = await box(page, '.idocs-bar')
    expect(Math.abs(bar.x - frame.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(bar.w - frame.w)).toBeLessThanOrEqual(1)
    expect(Math.abs(bar.y - frame.bottom)).toBeLessThanOrEqual(2)
    // Nothing is chosen, so it only offers the scenarios.
    expect(await page.locator('.idocs-sel-label').textContent()).toBe('Choose a scenario')
    expect(await page.locator('.idocs-bar-hint').count()).toBe(1)
    expect(await page.locator('.idocs-slider').count()).toBe(0)
    await close()
  })

  it('has no bar on a view without scenarios, and the picture is a whole box again', async () => {
    const { page, close } = await open()
    await pickView(page, 'Backend only')
    await page.waitForFunction(() => !document.querySelector('.idocs-bar'))
    expect(await page.locator('.idocs-workspace.has-bar').count()).toBe(0)
    await close()
  })

  it('chooses a scenario from a menu that says how long each is, with the keyboard too', async () => {
    const { page, close } = await open()
    await page.locator('.idocs-sel-btn').click()
    const items = page.locator('.idocs-sel-item')
    expect(await items.first().locator('.idocs-sel-title').textContent()).toBe('Overview')
    expect(await items.first().getAttribute('aria-checked')).toBe('true')
    const order = items.filter({ hasText: 'Place an order' })
    expect(await order.locator('.idocs-sel-meta').textContent()).toMatch(/\d+ steps · \d+ phases/)
    expect(await order.locator('.idocs-sel-sum').textContent()).not.toBe('')
    // It opens upward, over the picture.
    const menu = await box(page, '.idocs-sel-pop')
    const bar = await box(page, '.idocs-bar')
    expect(menu.bottom).toBeLessThanOrEqual(bar.y + 12)

    // The arrows move, Enter chooses, and the menu goes away with the choice.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.idocs-sel-pop', { state: 'detached' })
    expect(await page.locator('.idocs-sel-label').textContent()).toBe('Place an order')

    // Escape puts it away without choosing, and a press outside does too.
    await page.locator('.idocs-sel-btn').click()
    await page.keyboard.press('Escape')
    await page.waitForSelector('.idocs-sel-pop', { state: 'detached' })
    expect(await page.locator('.idocs-sel-label').textContent()).toBe('Place an order')
    await page.locator('.idocs-sel-btn').click()
    await page.mouse.click(5, 5)
    await page.waitForSelector('.idocs-sel-pop', { state: 'detached' })

    // The overview is the way back to the diagram on its own.
    await pick(page, 'Overview')
    expect(await page.locator('.idocs-sel-label').textContent()).toBe('Choose a scenario')
    expect(await page.locator('.idocs-slider').count()).toBe(0)
    await close()
  })

  it('says what the scenario is about before it starts, and the step in progress once it has', async () => {
    const { page, close } = await open('/examples/checkout/#checkout=place-order')
    await page.waitForSelector('.idocs-bar .idocs-slider')
    // Linked to, not started: it waits for the reader, and says how long it is.
    expect(await page.locator('.idocs-bar-meta').textContent()).toMatch(/9 steps · 3 phases/)
    expect(await page.locator('.idocs-bar-note').textContent()).not.toBe('')
    expect(await page.locator('.idocs-bar-title').count()).toBe(0)
    expect(await page.locator('.idocs-bar .idocs-btn.is-primary').textContent()).toBe('Play')

    await page.locator('.idocs-bar .idocs-btn.is-primary').click()
    await waitForStep(page)
    // A chip with the phase, the title of the step, and who talks to whom.
    expect(await page.locator('.idocs-bar-chip').textContent()).toMatch(/^I · /)
    expect(await page.locator('.idocs-bar-title b').textContent()).not.toBe('')
    expect(await page.locator('.idocs-bar-route').textContent()).toContain('→')
    expect(await page.locator('.idocs-time').textContent()).toMatch(/^step \d\/9 · /)
    await close()
  })

  it('does not change height from one step to the next', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await waitForStep(page)
    const heights = new Set<number>()
    for (let i = 0; i < 9; i++) {
      await page.locator('button[aria-label="Next step"]').dispatchEvent('click')
      await page.waitForTimeout(300)
      heights.add(Math.round((await box(page, '.idocs-bar')).h))
    }
    expect(heights.size).toBe(1)
    await close()
  })

  it('keeps its words in every presentation, and hides them with CC', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-bar-title')
    const cc = page.locator('.idocs-bar .idocs-cc')
    expect(await cc.getAttribute('aria-pressed')).toBe('true')
    await page.locator('.idocs-modes button:has-text("Story")').click()
    await page.waitForSelector('.idocs-story-grid')
    expect(await page.locator('.idocs-bar-title').count()).toBe(1)
    await cc.click()
    expect(await cc.getAttribute('aria-pressed')).toBe('false')
    expect(await page.locator('.idocs-bar-title').count()).toBe(0)
    expect(await page.locator('.idocs-bar-words').count()).toBe(0)
    // The controls are still there without the words.
    expect(await page.locator('.idocs-slider').count()).toBe(1)
    await cc.click()
    await page.waitForSelector('.idocs-bar-title')
    await close()
  })
})

describe('the slider', () => {
  const slider = (page: Page) => page.locator('.idocs-slider')

  it('has a section for each phase and a segment of the same width for each step', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-slider')
    expect(await page.locator('.idocs-slider-section').count()).toBe(3)
    // 9 steps, two of them in one parallel block, so one stop for both.
    const widths = await page
      .locator('.idocs-slider-cell')
      .evaluateAll((cells) => cells.map((c) => Math.round(c.getBoundingClientRect().width)))
    expect(widths).toHaveLength(8)
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
    // Phases are separated by more than steps are: the first of a section starts later.
    const gaps = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.idocs-slider-cell > span')].map((c) =>
        c.getBoundingClientRect(),
      )
      return cells.slice(1).map((c, i) => c.left - cells[i]!.right)
    })
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) + 2)
    await close()
  })

  it('goes to the step that is clicked, and tells which one is under the pointer', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-slider')
    const r = await box(page, '.idocs-slider')
    // Pointing is enough for a tip: the phase, the number and the title of the step.
    await page.mouse.move(r.x + r.w * 0.55, r.y + r.h / 2)
    await page.waitForSelector('.idocs-slider-tip')
    expect(await page.locator('.idocs-slider-tip').textContent()).toMatch(/^[IVX]+ · .+ — \d+\. .+/)
    // Pressing goes there, and stops the scenario so the reader can look.
    await page.mouse.click(r.x + r.w * 0.55, r.y + r.h / 2)
    expect(await slider(page).getAttribute('aria-valuenow')).toBe('5')
    expect(await page.locator('.idocs-bar .idocs-btn.is-primary').textContent()).toMatch(/Resume/)
    expect(await slider(page).getAttribute('aria-valuetext')).toMatch(/^Step \d of 9: /)
    // The fill reaches what was clicked.
    const filled = await page
      .locator('.idocs-slider-cell b')
      .evaluateAll((bs) =>
        bs.map((b) => Math.round((b as HTMLElement).getBoundingClientRect().width)),
      )
    expect(filled.filter((w) => w > 1).length).toBeGreaterThanOrEqual(4)
    await close()
  })

  it('can be dragged, and moved from the keyboard', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-slider')
    const r = await box(page, '.idocs-slider')
    await page.mouse.move(r.x + 4, r.y + r.h / 2)
    await page.mouse.down()
    await page.mouse.move(r.x + r.w * 0.9, r.y + r.h / 2, { steps: 6 })
    await page.mouse.up()
    expect(await slider(page).getAttribute('aria-valuenow')).toBe('8')

    await slider(page).focus()
    await page.keyboard.press('Home')
    expect(await slider(page).getAttribute('aria-valuenow')).toBe('1')
    await page.keyboard.press('End')
    expect(await slider(page).getAttribute('aria-valuenow')).toBe('8')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await waitForStep(page)
    await close()
  })
})

describe('the list of steps', () => {
  it('opens upward from the bar with the story in a few words and every step, and goes away again', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await waitForStep(page)
    // Nothing is listed until it is asked for.
    expect(await page.locator('.idocs-step').count()).toBe(0)
    await openSteps(page)
    expect(await page.locator('.idocs-steps-btn').getAttribute('aria-expanded')).toBe('true')
    expect(await page.locator('.idocs-panel-summary-title').textContent()).toBe(
      'The story in one breath',
    )
    expect(await page.locator('.idocs-steps-pop .idocs-step').count()).toBe(9)
    expect(await page.locator('.idocs-steps-pop .idocs-phase.is-fold').count()).toBe(3)
    const pop = await box(page, '.idocs-steps-pop')
    const bar = await box(page, '.idocs-bar')
    const frame = await box(page, '.idocs-frame')
    expect(pop.bottom).toBeLessThanOrEqual(bar.y + 1)
    expect(pop.y).toBeGreaterThanOrEqual(frame.y)

    // Escape folds it away and puts the reader back on the button.
    await page.keyboard.press('Escape')
    await page.waitForSelector('.idocs-steps-pop', { state: 'detached' })
    expect(await page.evaluate(() => document.activeElement?.className)).toContain(
      'idocs-steps-btn',
    )
    // So does a press on the picture.
    await openSteps(page)
    await page.mouse.click(frame.x + frame.w / 2, frame.y + 6)
    await page.waitForSelector('.idocs-steps-pop', { state: 'detached' })
    await close()
  })

  it('plays the step that is clicked', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await openSteps(page)
    await page.locator('.idocs-steps-pop .idocs-step').nth(4).dispatchEvent('click')
    await page.waitForFunction(() =>
      /step 5\//.test(document.querySelector('.idocs-time')!.textContent!),
    )
    expect(await stepNow(page)).toBe(5)
    await close()
  })

  it('keeps the step in progress in view inside itself and never scrolls the page', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await openSteps(page)
    const scrolled = await page.evaluate(() => scrollY)
    const inside = () =>
      page.evaluate(() => {
        const body = document.querySelector('.idocs-steps-pop-body')!.getBoundingClientRect()
        const step = document.querySelector('.idocs-step.is-active')?.getBoundingClientRect()
        return !step || (step.top >= body.top - 2 && step.bottom <= body.bottom + 2)
      })
    for (let i = 0; i < 12; i++) {
      // Dispatched, not clicked: the page writes the step to the address bar whenever playback
      // stops, and a click that overlaps that makes Playwright retry with the button forced to the
      // edge of the window, which scrolls the page. That is the test's doing, not the page's.
      await page.locator('button[aria-label="Next step"]').dispatchEvent('click')
      // The list scrolls smoothly, and for as long as the distance takes: wait for it to settle.
      await page
        .waitForFunction(
          () => {
            const body = document.querySelector('.idocs-steps-pop-body')!.getBoundingClientRect()
            const step = document.querySelector('.idocs-step.is-active')?.getBoundingClientRect()
            return !step || (step.top >= body.top - 2 && step.bottom <= body.bottom + 2)
          },
          null,
          { timeout: 2500 },
        )
        .catch(() => {})
      expect(await inside(), `step ${i + 1}`).toBe(true)
    }
    expect(await page.evaluate(() => scrollY)).toBe(scrolled)
    await close()
  })
})

describe('phases', () => {
  const head = (page: Page, title: string) =>
    page.locator('.idocs-phase.is-fold').filter({ hasText: title })
  const steps = (page: Page) => page.locator('.idocs-steps-pop .idocs-step')

  it('are headers in the list of steps that fold them away, and open them again', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await openSteps(page)
    const all = await steps(page).count()
    const charge = head(page, 'Charge')
    expect(await charge.getAttribute('aria-expanded')).toBe('true')
    expect(await charge.locator('.idocs-phase-count').textContent()).toBe('3')

    await charge.click()
    expect(await charge.getAttribute('aria-expanded')).toBe('false')
    expect(await steps(page).count()).toBe(all - 3)
    // Folded away, it still says how many steps it holds.
    expect(await charge.locator('.idocs-phase-count').textContent()).toBe('3')
    // The others are untouched.
    expect(await head(page, 'Submit').getAttribute('aria-expanded')).toBe('true')

    await charge.click()
    expect(await steps(page).count()).toBe(all)
    await close()
  })

  it('say how far a folded phase has got, and what is happening in it, while it plays', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await openSteps(page)
    const charge = head(page, 'Charge')
    // Play step 3, the first of the Charge phase, then fold the phase while it is in progress.
    await steps(page).nth(2).click()
    await charge.click()
    await page.waitForSelector('.idocs-phase.is-fold.is-active')
    expect(await charge.getAttribute('class')).toContain('is-active')
    expect(await charge.locator('.idocs-phase-caption').textContent()).toMatch(/^now: /)
    expect(await charge.locator('.idocs-phase-count').textContent()).toMatch(/^\d\/3$/)
    // The scenario carries on playing, and the bar still says what it is doing.
    expect(await page.locator('.idocs-bar-title').count()).toBe(1)
    await close()
  })

  it('can all be folded or shown from the bar above the steps', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await openSteps(page)
    await page.getByRole('button', { name: 'Fold every phase away' }).click()
    expect(await steps(page).count()).toBe(0)
    expect(await page.locator('.idocs-phase.is-fold[aria-expanded="false"]').count()).toBe(3)
    await page.getByRole('button', { name: 'Show every phase' }).click()
    expect(await steps(page).count()).toBeGreaterThan(5)
    await close()
  })

  it('are folded the same way in the sequence and the story, and belong to one scenario', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await openSteps(page)
    await head(page, 'Charge').click()
    await closeSteps(page)

    await page.locator('.idocs-modes button:has-text("Sequence")').click()
    await page.waitForSelector('.idocs-seq svg')
    const phase = page.locator('.seq-phase-row').nth(1)
    expect(await phase.getAttribute('aria-expanded')).toBe('false')
    expect(await page.locator('.seq-row').count()).toBe(6)
    // Showing it here shows it everywhere.
    await phase.dispatchEvent('click')
    expect(await page.locator('.seq-row').count()).toBe(9)
    await phase.dispatchEvent('click')

    await page.locator('.idocs-modes button:has-text("Story")').click()
    await page.waitForSelector('.idocs-story-grid')
    expect(await page.locator('.idocs-phase-label.is-strip').count()).toBe(1)
    expect(await page.locator('.idocs-phase-label.is-strip').textContent()).toContain('Charge')
    expect(await page.locator('.idocs-phase-label.is-strip').textContent()).toContain('3 steps')
    // Lanes and the boxes of the phases still shown are all there, and connectors are measured.
    await page.waitForSelector('.idocs-slink')

    // Open it from the story: the list of steps shows it again too.
    await page.locator('.idocs-phase-label.is-strip').click()
    expect(await page.locator('.idocs-phase-label.is-strip').count()).toBe(0)
    await page.locator('.idocs-modes button:has-text("Flow")').click()
    await openSteps(page)
    expect(await head(page, 'Charge').getAttribute('aria-expanded')).toBe('true')

    // Another scenario starts with everything shown.
    await head(page, 'Charge').click()
    await pick(page, 'Card declined')
    expect(await page.locator('.idocs-phase.is-fold[aria-expanded="false"]').count()).toBe(0)
    await close()
  })

  it('can be folded away from the story with the label of the phase', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.locator('.idocs-modes button:has-text("Story")').click()
    await page.waitForSelector('.idocs-story-grid')
    const boxes = await page.locator('.idocs-sbox').count()
    await page.locator('.idocs-phase-fold').nth(1).click()
    expect(await page.locator('.idocs-sbox').count()).toBeLessThan(boxes)
    expect(await page.locator('.idocs-phase-label.is-strip').count()).toBe(1)
    await close()
  })
})

describe('the sequence and the story', () => {
  it('scroll inside the same frame as the picture, with the panel over it', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.locator('.idocs-modes button:has-text("Story")').click()
    await page.waitForSelector('.idocs-story-grid')
    expect(await page.locator('.idocs-scrollframe > .idocs-panel').count()).toBe(1)
    const panel = await box(page, '.idocs-panel')
    // The content starts to the right of the panel, not underneath it.
    const grid = await box(page, '.idocs-story-grid')
    expect(grid.x).toBeGreaterThanOrEqual(panel.right - 1)
    // The frame has a height of its own: a long story scrolls in it and not the page.
    const frame = await box(page, '.idocs-scrollframe')
    expect(frame.h).toBeLessThanOrEqual(900)
    expect(
      await page.locator('.idocs-scroller').evaluate((e) => e.scrollHeight > e.clientHeight),
    ).toBe(true)
    await close()
  })

  it('keep the step in progress in view inside their frame', async () => {
    const { page, close } = await open('/examples/platform/')
    await pick(page, 'One read request')
    await page.waitForSelector('.idocs-story-grid')
    const scrolled = await page.evaluate(() => scrollY)
    await openSteps(page)
    // Dispatched, because a click would scroll the page to bring the step into view first.
    await page.locator('.idocs-steps-pop .idocs-step').last().dispatchEvent('click')
    await page.waitForTimeout(900)
    const visible = await page.evaluate(() => {
      const view = document.querySelector('.idocs-scroller')!.getBoundingClientRect()
      const at = document.querySelector('.idocs-sbox.is-active')?.getBoundingClientRect()
      return !!at && at.top >= view.top - 2 && at.bottom <= view.bottom + 2
    })
    expect(visible).toBe(true)
    expect(await page.evaluate(() => scrollY)).toBe(scrolled)
    await close()
  })
})

describe('folding the panel', () => {
  it('leaves one button, gives the room to the picture, keeps the bar, and opens again', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    const frame = await box(page, '.idocs-frame')
    const left = await pictureLeft(page)
    await page.getByRole('button', { name: 'Hide the panel' }).click()
    await page.waitForSelector('.idocs-panel.is-folded')
    // Only the button is left: what is playing is on the bar, which is where its controls are.
    expect(await page.locator('.idocs-panel.is-folded button').count()).toBe(1)
    expect(await page.locator('.idocs-panel-now, .idocs-rail-player').count()).toBe(0)
    expect(await page.locator('.idocs-bar .idocs-sel-label').textContent()).toBe('Place an order')
    expect(await page.locator('.idocs-bar [aria-label="Next step"]').count()).toBe(1)
    // The frame stays as it is, so the page does not jump; the picture grows into the room.
    const after = await box(page, '.idocs-frame')
    expect(after.h).toBe(frame.h)
    expect(after.w).toBe(frame.w)
    await page.waitForTimeout(600)
    expect(await pictureLeft(page)).toBeLessThan(left - 100)
    // The bar still plays.
    await page.locator('.idocs-bar .idocs-btn.is-primary').click()

    await page.getByRole('button', { name: 'Show the panel' }).click()
    await page.waitForSelector('.idocs-panel-tab')
    await close()
  })
})

describe('the dotted lines of the story and sequence views', () => {
  it('run between the lanes of the story, and through the middle of each header of the sequence', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.locator('.idocs-modes button:has-text("Story")').click()
    await page.waitForSelector('.idocs-story-grid')
    await page.waitForTimeout(500)
    const lanes = await page.locator('.idocs-lane-head').count()
    expect(await page.locator('.idocs-lane-sep').count()).toBe(lanes + 1)
    const clear = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.idocs-lane-head')].map((e) =>
        e.getBoundingClientRect(),
      )
      return [...document.querySelectorAll('.idocs-lane-sep')].map((l) => {
        const x = l.getBoundingClientRect().x
        // Not through the middle half of any lane.
        return heads.every((h) => Math.abs(x - (h.x + h.width / 2)) > h.width / 4)
      })
    })
    expect(clear.every(Boolean)).toBe(true)

    await page.locator('.idocs-modes button:has-text("Sequence")').click()
    await page.waitForSelector('.idocs-seq svg')
    const actors = await page.locator('.idocs-seq .seq-title').count()
    expect(await page.locator('.idocs-seq .seq-lifeline').count()).toBe(actors)
    // A lifeline is the middle of its header, and the arrows start and end on it.
    const centred = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.idocs-seq svg > g > rect')]
        .map((r) => r.getBoundingClientRect())
        .filter((r) => r.height > 45)
      return [...document.querySelectorAll('.idocs-seq .seq-lifeline')].map((l, i) => {
        const x = l.getBoundingClientRect().x
        const head = heads[i]!
        return Math.abs(x - (head.x + head.width / 2)) < 1.5
      })
    })
    expect(centred).toHaveLength(actors)
    expect(centred.every(Boolean)).toBe(true)
    await close()
  })
})

describe('a narrow widget', () => {
  it('starts with the panel folded, covers the picture when it is opened, and stays inside the window', async () => {
    const { page, problems, close } = await open('/examples/checkout/', 560)
    await page.waitForSelector('.idocs-panel.is-folded')
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
    expect(await overflow()).toBeLessThanOrEqual(0)

    await page.getByRole('button', { name: 'Show the panel' }).click()
    await page.waitForSelector('.idocs-panel-tab')
    const panel = await box(page, '.idocs-panel')
    const frame = await box(page, '.idocs-frame')
    // A sheet over the lower part of the picture, inside the frame.
    expect(panel.x).toBeGreaterThanOrEqual(frame.x)
    expect(panel.right).toBeLessThanOrEqual(frame.right)
    expect(panel.bottom).toBeLessThanOrEqual(frame.bottom)
    expect(panel.w).toBeGreaterThan(frame.w - 30)
    expect(await overflow()).toBeLessThanOrEqual(0)
    expect(problems).toEqual([])
    await close()
  })

  it('wraps the bar into rows that fit, with its menu and list inside the window', async () => {
    const { page, problems, close } = await open('/examples/checkout/', 560)
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
    await pick(page, 'Place an order')
    await waitForStep(page)
    const bar = await box(page, '.idocs-bar')
    const frame = await box(page, '.idocs-frame')
    expect(Math.abs(bar.w - frame.w)).toBeLessThanOrEqual(1)
    // The slider has a row of its own, as wide as the bar allows.
    const slider = await box(page, '.idocs-slider')
    expect(slider.w).toBeGreaterThan(bar.w - 40)
    expect(
      await page.locator('.idocs-bar').evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true)
    await page.locator('.idocs-slider').hover({ position: { x: slider.w - 4, y: 10 } })
    await page.waitForSelector('.idocs-slider-tip')
    expect(await overflow()).toBeLessThanOrEqual(0)
    await openSteps(page)
    const pop = await box(page, '.idocs-steps-pop')
    expect(pop.x).toBeGreaterThanOrEqual(bar.x)
    expect(pop.right).toBeLessThanOrEqual(bar.right + 1)
    expect(await overflow()).toBeLessThanOrEqual(0)
    expect(problems).toEqual([])
    await close()
  })
})

describe('the interfaces table', () => {
  const head = (page: Page) => page.locator('.idocs-ifaces-head')

  it('starts folded to a bar that says what is in it, and opens and folds with a click', async () => {
    const { page, problems, close } = await open()
    await page.locator('.idocs-ifaces').scrollIntoViewIfNeeded()
    expect(await head(page).getAttribute('aria-expanded')).toBe('false')
    expect(await head(page).textContent()).toContain('Interfaces')
    expect(await head(page).textContent()).toContain('13 connections')
    expect(await page.locator('.idocs-ifaces table').count()).toBe(0)

    await head(page).click()
    expect(await head(page).getAttribute('aria-expanded')).toBe('true')
    expect(await page.locator('.idocs-ifaces tbody tr').count()).toBe(13)
    // The bar is the top of the table, not a second box above it.
    const joined = await page.evaluate(() => {
      const bar = document.querySelector('.idocs-ifaces-head')!.getBoundingClientRect()
      const table = document
        .querySelector('.idocs-ifaces .idocs-table-wrap')!
        .getBoundingClientRect()
      return Math.abs(table.top - bar.bottom)
    })
    expect(joined).toBeLessThanOrEqual(1)

    // The row still lights up its connection in the picture.
    await page.locator('.idocs-ifaces tbody tr').first().hover()
    await page.waitForSelector('.idocs-frame .is-hl')

    await head(page).click()
    expect(await head(page).getAttribute('aria-expanded')).toBe('false')
    expect(await page.locator('.idocs-ifaces table').count()).toBe(0)
    expect(problems).toEqual([])
    await close()
  })

  it('is reachable from the keyboard, and stays as the reader left it when the view changes', async () => {
    const { page, close } = await open()
    await head(page).focus()
    await page.keyboard.press('Enter')
    expect(await head(page).getAttribute('aria-expanded')).toBe('true')
    await pickView(page, 'Backend only')
    // This view lists no interfaces, so there is no bar for it.
    await page.waitForFunction(() => !document.querySelector('.idocs-ifaces'))
    await pickView(page, 'Overview')
    await page.waitForSelector('.idocs-ifaces')
    expect(await head(page).getAttribute('aria-expanded')).toBe('true')
    await close()
  })
})
