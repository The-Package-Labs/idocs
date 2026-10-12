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
  await page.waitForSelector('.idocs-side')
  await page.waitForSelector('[data-node]')
  await page.locator('.idocs-side').first().scrollIntoViewIfNeeded()
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

describe('the side panel', () => {
  it('sits to the left of the picture, as tall as it, with the scenarios, timeline and views as tabs', async () => {
    const { page, problems, close } = await open()
    const side = await box(page, '.idocs-side-in')
    const frame = await box(page, '.idocs-frame')
    expect(side.right).toBeLessThanOrEqual(frame.x)
    expect(Math.abs(side.bottom - frame.bottom)).toBeLessThanOrEqual(2)
    // Before a scenario is chosen there is nothing to follow: scenarios and views.
    expect(await page.locator('.idocs-side-tab').allTextContents()).toEqual(['Scenarios', 'Views'])
    expect(await page.locator('.idocs-side-tab[aria-selected="true"]').textContent()).toBe(
      'Scenarios',
    )

    await pick(page, 'Place an order')
    expect(await page.locator('.idocs-side-tab').allTextContents()).toEqual([
      'Scenarios',
      'Timeline',
      'Views',
    ])
    expect(await page.locator('.idocs-side-tab[aria-selected="true"]').textContent()).toBe(
      'Timeline',
    )
    expect(await chosen(page)).toBe('Place an order')
    expect(problems).toEqual([])
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
    await page.locator('.idocs-side-tab[aria-selected="true"]').focus()
    await page.keyboard.press('ArrowRight')
    expect(await page.locator('.idocs-side-tab[aria-selected="true"]').textContent()).toBe('Views')
    await page.keyboard.press('ArrowLeft')
    expect(await page.locator('.idocs-side-tab[aria-selected="true"]').textContent()).toBe(
      'Scenarios',
    )
    await close()
  })

  it('lists the views, and switching one shows its own scenarios', async () => {
    const { page, close } = await open()
    const before = await page.locator('[data-node]').count()
    await pickView(page, 'Backend only')
    await page.waitForFunction((n) => document.querySelectorAll('[data-node]').length < n, before)
    // The panel goes back to what to look at, not to a timeline that no longer exists.
    expect(await page.locator('.idocs-side-tab[aria-selected="true"]').textContent()).not.toBe(
      'Timeline',
    )
    await close()
  })
})

describe('the timeline', () => {
  it('is beside the picture, keeps the step in progress in view and never scrolls the page', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-step.is-active')
    const scrolled = await page.evaluate(() => scrollY)
    // Step through to the end: the active step is always inside the panel's visible area.
    for (let i = 0; i < 12; i++) {
      await page.locator('button[aria-label="Next step"]').click()
      await page.waitForTimeout(450)
      const inside = await page.evaluate(() => {
        const body = document.querySelector('.idocs-side-body')!.getBoundingClientRect()
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
    await page.waitForSelector('.idocs-side .idocs-player')
    expect(await page.locator('.idocs-side-summary-title').textContent()).toBe(
      'The story in one breath',
    )
    const side = await box(page, '.idocs-side-in')
    const player = await box(page, '.idocs-side .idocs-player')
    expect(player.bottom).toBeLessThanOrEqual(side.bottom + 1)
    expect(player.x).toBeGreaterThanOrEqual(side.x)
    // Nothing of the old stacked layout is left outside the panel.
    expect(
      await page.locator('.idocs-level > .idocs-player, .idocs-workspace ~ .idocs-steps').count(),
    ).toBe(0)
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
    expect(await page.locator('.idocs-subtitles').first().getAttribute('class')).not.toContain(
      'is-sticky',
    )
    // They sit over the bottom of the picture.
    const frame = await box(page, '.idocs-frame')
    const subtitle = await box(page, '.idocs-subtitles')
    expect(subtitle.bottom).toBeLessThanOrEqual(frame.bottom)
    expect(subtitle.y).toBeGreaterThan(frame.y + frame.h / 2)

    const cc = page.locator('.idocs-side .idocs-cc')
    expect(await cc.getAttribute('aria-pressed')).toBe('true')
    await cc.click()
    expect(await cc.getAttribute('aria-pressed')).toBe('false')
    expect(await page.locator('.idocs-subtitle').count()).toBe(0)
    await cc.click()
    await page.waitForSelector('.idocs-subtitle')
    await close()
  })

  it('can also be turned off from the picture’s toolbar, and follow the story view', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    await page.waitForSelector('.idocs-subtitle')
    const toolbar = page.locator('.idocs-toolbar button:has-text("CC")')
    await toolbar.click()
    expect(await page.locator('.idocs-subtitle').count()).toBe(0)
    await toolbar.click()
    await page.locator('.idocs-modes button:has-text("Story")').click()
    await page.waitForSelector('.idocs-story-grid')
    await page.waitForSelector('.idocs-subtitles.is-sticky .idocs-subtitle')
    await close()
  })
})

describe('folding the panel', () => {
  it('leaves a rail with the player’s buttons, gives the room to the picture, and opens again', async () => {
    const { page, close } = await open()
    await pick(page, 'Place an order')
    const wide = await box(page, '.idocs-frame')
    await page.getByRole('button', { name: 'Hide the panel' }).click()
    await page.waitForSelector('.idocs-side.is-folded .idocs-rail')
    expect(await page.locator('.idocs-rail [aria-label="Next step"]').count()).toBe(1)
    expect(await page.locator('.idocs-rail [aria-label="Previous step"]').count()).toBe(1)
    expect((await box(page, '.idocs-frame')).w).toBeGreaterThan(wide.w + 200)
    // The rail still plays.
    await page.locator('.idocs-rail .idocs-btn.is-primary').click()

    await page.getByRole('button', { name: 'Show the panel' }).click()
    await page.waitForSelector('.idocs-side-tab')
    expect((await box(page, '.idocs-frame')).w).toBeCloseTo(wide.w, -1)
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
  it('puts the panel above the picture, and stays inside the window', async () => {
    const { page, problems, close } = await open('/examples/checkout/', 700)
    const side = await box(page, '.idocs-side-in')
    const frame = await box(page, '.idocs-frame')
    expect(side.bottom).toBeLessThanOrEqual(frame.y + 1)
    expect(side.h).toBeLessThanOrEqual(430)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    expect(problems).toEqual([])
    await close()
  })
})
