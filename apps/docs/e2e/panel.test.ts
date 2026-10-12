import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'
import { chosen, pick, pickView } from './panel'

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
  it('floats inside the viewport, over the left of the picture, with the outline, scenarios and views as tabs', async () => {
    const { page, problems, close } = await open()
    const panel = await box(page, '.idocs-panel')
    const frame = await box(page, '.idocs-frame')
    // Inside the frame the picture is drawn in, not beside it.
    expect(await page.locator('.idocs-frame > .idocs-panel').count()).toBe(1)
    expect(panel.x).toBeGreaterThanOrEqual(frame.x)
    expect(panel.right).toBeLessThan(frame.right - 300)
    expect(panel.y).toBeGreaterThanOrEqual(frame.y)
    expect(panel.bottom).toBeLessThanOrEqual(frame.bottom)
    // Before a scenario is chosen there is nothing to follow.
    expect(await tabs(page)).toEqual(['Outline', 'Views', 'Scenarios'])
    expect(await selectedTab(page)).toBe('Scenarios')

    await pick(page, 'Place an order')
    expect(await tabs(page)).toEqual(['Outline', 'Views', 'Scenarios', 'Timeline'])
    expect(await selectedTab(page)).toBe('Timeline')
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

  it('gives each scenario a card with its length and how it divides up', async () => {
    const { page, close } = await open()
    const cards = page.locator('.idocs-scn')
    expect(await cards.first().locator('.idocs-scn-title').textContent()).toBe('Overview')
    const order = cards.filter({ hasText: 'Place an order' })
    expect(await order.locator('.idocs-scn-meta').textContent()).toMatch(/\d+ steps · \d+ phases/)
    expect(await order.locator('.idocs-scn-sum').textContent()).not.toBe('')
    expect(await order.locator('.idocs-scn-bar i').count()).toBeGreaterThan(1)
    await close()
  })

  it('moves between the tabs with the arrow keys', async () => {
    const { page, close } = await open()
    await page.locator('.idocs-panel-tab[aria-selected="true"]').focus()
    await page.keyboard.press('ArrowLeft')
    expect(await selectedTab(page)).toBe('Views')
    await page.keyboard.press('ArrowRight')
    expect(await selectedTab(page)).toBe('Scenarios')
    await close()
  })

  it('keeps the tabs where they are when others come and go, so a click never lands on the wrong one', async () => {
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
    // A scenario brings a Timeline tab...
    await pick(page, 'Place an order')
    const withScenario = await places()
    expect(withScenario.Outline).toBe(before.Outline)
    expect(withScenario.Views).toBe(before.Views)
    expect(withScenario.Scenarios).toBe(before.Scenarios)
    // ...after the tabs that were there, never in front of them.
    expect(withScenario.Timeline).toBeGreaterThan(withScenario.Scenarios!)

    // And a view with no scenarios takes the Scenarios tab away, and nothing else moves.
    await pickView(page, 'Backend only')
    await page.waitForFunction(() => document.querySelectorAll('.idocs-panel-tab').length === 2)
    const without = await places()
    expect(without.Outline).toBe(before.Outline)
    expect(without.Views).toBe(before.Views)
    // Whatever it was aimed at, a view is never followed by the timeline of a scenario.
    expect(await selectedTab(page)).not.toBe('Timeline')
    await close()
  })

  it('lists the views, and switching one shows its own scenarios', async () => {
    const { page, close } = await open()
    const before = await page.locator('[data-node]').count()
    await pickView(page, 'Backend only')
    await page.waitForFunction((n) => document.querySelectorAll('[data-node]').length < n, before)
    // The panel goes back to what to look at, not to a timeline that no longer exists.
    expect(await selectedTab(page)).not.toBe('Timeline')
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

describe('the timeline', () => {
  it('keeps the step in progress in view inside the panel and never scrolls the page', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-step.is-active')
    const scrolled = await page.evaluate(() => scrollY)
    // Step through to the end: the active step is always inside the panel's visible area.
    for (let i = 0; i < 12; i++) {
      // Dispatched, not clicked: the page writes the step to the address bar whenever playback
      // stops, and a click that overlaps that makes Playwright retry with the button forced to the
      // edge of the window, which scrolls the page. That is the test's doing, not the page's.
      await page.locator('button[aria-label="Next step"]').dispatchEvent('click')
      await page.waitForTimeout(450)
      const inside = await page.evaluate(() => {
        const body = document.querySelector('.idocs-panel-body')!.getBoundingClientRect()
        const step = document.querySelector('.idocs-step.is-active')?.getBoundingClientRect()
        return !step || (step.top >= body.top - 2 && step.bottom <= body.bottom + 2)
      })
      expect(inside, `step ${i + 1}`).toBe(true)
    }
    expect(await page.evaluate(() => scrollY)).toBe(scrolled)
    await close()
  })

  it('has the summary at the top, and the player docked under it', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-panel .idocs-player')
    expect(await page.locator('.idocs-panel-summary-title').textContent()).toBe(
      'The story in one breath',
    )
    const panel = await box(page, '.idocs-panel')
    const player = await box(page, '.idocs-panel .idocs-player')
    expect(player.bottom).toBeLessThanOrEqual(panel.bottom + 1)
    expect(player.x).toBeGreaterThanOrEqual(panel.x)
    // Nothing of the old stacked layout is left outside the viewport.
    expect(
      await page.locator('.idocs-level > .idocs-player, .idocs-workspace ~ .idocs-steps').count(),
    ).toBe(0)
    await close()
  })
})

describe('phases', () => {
  const head = (page: Page, title: string) =>
    page.locator('.idocs-phase.is-fold').filter({ hasText: title })
  const steps = (page: Page) => page.locator('.idocs-panel .idocs-step')

  it('are headers in the timeline that fold their steps away, and open them again', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
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
    const charge = head(page, 'Charge')
    // Play step 3, the first of the Charge phase, then fold the phase while it is in progress.
    await steps(page).nth(2).click()
    await charge.click()
    await page.waitForSelector('.idocs-phase.is-fold.is-active')
    expect(await charge.getAttribute('class')).toContain('is-active')
    expect(await charge.locator('.idocs-phase-caption').textContent()).toMatch(/^now: /)
    expect(await charge.locator('.idocs-phase-count').textContent()).toMatch(/^\d\/3$/)
    // The scenario carries on playing in the picture.
    expect(await page.locator('.idocs-subtitle').count()).toBe(1)
    await close()
  })

  it('can all be folded or shown from the bar above the steps', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
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
    await head(page, 'Charge').click()

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

    // Open it from the story: the timeline shows it again too.
    await page.locator('.idocs-phase-label.is-strip').click()
    expect(await page.locator('.idocs-phase-label.is-strip').count()).toBe(0)
    await page.locator('.idocs-modes button:has-text("Flow")').click()
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

describe('subtitles', () => {
  it('are on by default, say the step and its note, and can be turned off from the player', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-subtitle')
    const text = (await page.locator('.idocs-subtitle').first().textContent()) ?? ''
    expect(text).toMatch(/\d+\/\d+/)
    // They sit over the bottom of the viewport, in what the panel leaves of it.
    const frame = await box(page, '.idocs-frame')
    const subtitle = await box(page, '.idocs-subtitles')
    const panel = await box(page, '.idocs-panel')
    expect(subtitle.bottom).toBeLessThanOrEqual(frame.bottom)
    expect(subtitle.y).toBeGreaterThan(frame.y + frame.h / 2)
    expect(subtitle.x).toBeGreaterThanOrEqual(panel.right - 1)

    const cc = page.locator('.idocs-panel .idocs-cc')
    expect(await cc.getAttribute('aria-pressed')).toBe('true')
    await cc.click()
    expect(await cc.getAttribute('aria-pressed')).toBe('false')
    expect(await page.locator('.idocs-subtitle').count()).toBe(0)
    await cc.click()
    await page.waitForSelector('.idocs-subtitle')
    await close()
  })

  it('can also be turned off from the viewport’s toolbar, and follow the story view', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-subtitle')
    const toolbar = page.locator('.idocs-toolbar button:has-text("CC")')
    await toolbar.click()
    expect(await page.locator('.idocs-subtitle').count()).toBe(0)
    await toolbar.click()
    await page.locator('.idocs-modes button:has-text("Story")').click()
    await page.waitForSelector('.idocs-story-grid')
    // Over the story, inside its frame, like over the picture.
    await page.waitForSelector('.idocs-scrollframe > .idocs-subtitles .idocs-subtitle')
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
    // Dispatched, because a click would scroll the page to bring the step into view first.
    await page.locator('.idocs-step').last().dispatchEvent('click')
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
  it('leaves a pill with the player’s buttons, gives the room to the picture, and opens again', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    const frame = await box(page, '.idocs-frame')
    const left = await pictureLeft(page)
    await page.getByRole('button', { name: 'Hide the panel' }).click()
    await page.waitForSelector('.idocs-panel.is-folded')
    expect(await page.locator('.idocs-panel.is-folded [aria-label="Next step"]').count()).toBe(1)
    expect(await page.locator('.idocs-panel.is-folded [aria-label="Previous step"]').count()).toBe(
      1,
    )
    // The frame stays as it is, so the page does not jump; the picture grows into the room.
    const after = await box(page, '.idocs-frame')
    expect(after.h).toBe(frame.h)
    expect(after.w).toBe(frame.w)
    await page.waitForTimeout(600)
    expect(await pictureLeft(page)).toBeLessThan(left - 100)
    // The pill still plays.
    await page.locator('.idocs-panel.is-folded .idocs-btn.is-primary').click()

    await page.getByRole('button', { name: 'Show the panel' }).click()
    await page.waitForSelector('.idocs-panel-tab')
    await close()
  })
})

describe('the separators in the sequence and story views', () => {
  it('run between the lanes and at their edges, not through the middle of them', async () => {
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
    expect(await page.locator('.idocs-seq .seq-sep').count()).toBe(actors + 1)
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
})
