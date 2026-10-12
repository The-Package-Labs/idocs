import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'
import { pickView, scenarioTitles } from './panel'

const PORT = 4502
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

async function open(
  path: string,
  opts: { theme?: 'light' | 'dark'; width?: number; height?: number } = {},
) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    colorScheme: opts.theme ?? 'light',
  })
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) problems.push(m.text())
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  return { page, problems, close: () => ctx.close() }
}

/**
 * Brings a section into view so the diagrams in it hydrate (they load when visible). The page
 * scrolls smoothly, so jump instantly; a click would otherwise cut the animation short.
 */
const reveal = (page: Page, selector: string) =>
  page.evaluate(
    (s) => document.querySelector(s)?.scrollIntoView({ block: 'start', behavior: 'instant' }),
    selector,
  )

describe('landing page', () => {
  it('opens with the live checkout diagram, which starts playing on its own', async () => {
    const { page, problems, close } = await open('/')
    expect(await page.locator('h1').textContent()).toContain('press play')
    await page.waitForSelector('.lp-hero [data-node]')
    expect(await page.locator('.lp-hero [data-node]').count()).toBe(12)
    expect(await page.locator('.lp-hero .lp-stage-bar').first().textContent()).toContain('showcase')
    await page.waitForSelector('.lp-hero .idocs-packet', { state: 'attached', timeout: 15_000 })
    // A decorative demo must not write into the address bar.
    expect(await page.evaluate(() => location.hash)).toBe('')
    expect(problems).toEqual([])
    await close()
  })

  it('says what the i in idocs stands for', async () => {
    const { page, close } = await open('/')
    const words = await page.locator('.lp-iwords .lp-iword').allTextContents()
    expect(words.map((w) => w.trim())).toEqual([
      'interactive',
      'intuitive',
      'integrated',
      'impressive',
    ])
    // Every one starts with the i of idocs, picked out in the accent colour.
    expect(await page.locator('.lp-iwords .lp-i').allTextContents()).toEqual(['i', 'i', 'i', 'i'])
    expect(await page.locator('.lp-iwords-label').textContent()).toBe('the i in idocs')
    await close()
  })

  it('shows one diagram that uses the features: zones, statuses, edge kinds, nesting and views', async () => {
    const { page, problems, close } = await open('/')
    await page.waitForSelector('.lp-hero [data-node]')
    const hero = page.locator('.lp-hero')
    // Zones and frames, and the three statuses.
    expect(await hero.locator('.idocs-zone').count()).toBeGreaterThanOrEqual(5)
    for (const status of ['planned', 'legacy', 'optional']) {
      expect(await hero.locator(`.idocs-node.st-${status}`).count(), status).toBeGreaterThan(0)
    }
    // Cards with chips and a "uses" line, and cards that hold a diagram.
    expect(await hero.locator('.idocs-chips .idocs-chip').count()).toBeGreaterThan(1)
    expect(await hero.locator('[data-node] .idocs-node-uses').count()).toBeGreaterThan(0)
    expect(await hero.locator('[data-node="orders"] [data-act="expand"]').count()).toBe(1)
    // A custom edge kind in the legend, and an overview that fits whole.
    expect(await hero.locator('.idocs-legend').textContent()).toContain('Audit trail')
    // The overview fits whole, so the camera is not chasing the action.
    expect(await hero.locator('[aria-label="Fit to view"]').count()).toBe(1)
    expect(await hero.locator('.idocs-tool[aria-pressed="true"]:has-text("Follow")').count()).toBe(
      0,
    )
    // Views and scenarios are in the panel, which starts folded to a rail so the picture has room.
    expect(await hero.locator('.idocs-side.is-folded').count()).toBe(1)
    expect(await hero.locator('.idocs-rail [aria-label="Next step"]').count()).toBe(1)
    await hero.getByRole('button', { name: 'Show the panel' }).click()
    expect(await hero.locator('.idocs-side-tab').allTextContents()).toEqual([
      'Scenarios',
      'Timeline',
      'Views',
    ])
    expect(await scenarioTitles(page, '.lp-hero')).toEqual([
      'Overview',
      'Place an order',
      'Card declined',
    ])
    await pickView(page, 'Interfaces', '.lp-hero')
    await hero.locator('.idocs-scn[aria-pressed="true"]').waitFor()
    expect(problems).toEqual([])
    await close()
  })

  it('lets the reader expand a card in the hero, and play another view', async () => {
    const { page, problems, close } = await open('/')
    await page.waitForSelector('.lp-hero [data-node]')
    await page.click('.lp-hero [data-node="stock"] [data-act="expand"]')
    await page.waitForSelector('.lp-hero [data-inline][data-node="stock"]')
    expect(await page.locator('.lp-hero [data-node="stock/api"]').count()).toBe(1)
    await pickView(page, 'Interfaces', '.lp-hero')
    await page.waitForSelector('.lp-hero table')
    expect(problems).toEqual([])
    await close()
  })

  it('builds a diagram up tab by tab, and every tab draws its icons', async () => {
    const { page, problems, close } = await open('/')
    await reveal(page, '#how-it-works')
    const expected = { model: 6, zones: 6, scenario: 6, views: 4 }
    for (const [id, nodes] of Object.entries(expected)) {
      await page.click(`#tour-tab-${id}`)
      const panel = page.locator(`#tour-panel-${id}`)
      await panel.locator('[data-node]').first().waitFor()
      // The views tab opens on the processing view, which keeps four of the six boxes.
      expect(await panel.locator('[data-node]').count(), id).toBe(nodes)
      expect(await panel.locator('.lp-win').textContent(), id).toContain('title: Photo uploads')
      expect(await panel.locator('[data-node] .idocs-icon svg').count(), id).toBe(nodes)
    }
    // Marks the lines each step adds to the file.
    expect(await page.locator('#tour-panel-views .lp-win .line.ins').count()).toBeGreaterThan(5)
    expect(problems).toEqual([])
    await close()
  })

  it('gives every inline SVG its own ids, so a hidden tab cannot blank another diagram’s icons', async () => {
    const { page, close } = await open('/')
    for (const id of ['model', 'zones', 'scenario', 'views']) {
      await reveal(page, '#how-it-works')
      await page.click(`#tour-tab-${id}`)
      await page.locator(`#tour-panel-${id} [data-node]`).first().waitFor()
    }
    const duplicated = await page.evaluate(() => {
      const seen = new Map<string, number>()
      for (const el of document.querySelectorAll('svg [id]')) {
        seen.set(el.id, (seen.get(el.id) ?? 0) + 1)
      }
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
    })
    expect(duplicated).toEqual([])
    await close()
  })

  it('shows one scenario three ways', async () => {
    const { page, problems, close } = await open('/')
    await reveal(page, '#scenarios')
    await page.locator('#lens-panel-flow [data-node]').first().waitFor()
    await page.click('#lens-tab-sequence')
    await page.waitForSelector('#lens-panel-sequence .idocs-seq svg')
    await page.click('#lens-tab-story')
    await page.waitForSelector('#lens-panel-story .idocs-story-grid')
    expect(await page.locator('#lens-panel-story .idocs-lane-head').count()).toBeGreaterThan(3)
    expect(problems).toEqual([])
    await close()
  })

  it('restyles the diagram from a palette picker', async () => {
    const { page, close } = await open('/')
    await reveal(page, '#style')
    await page.locator('.lp-lab .idocs').first().waitFor()
    const accent = () =>
      page.evaluate(() =>
        getComputedStyle(document.querySelector('.lp-lab .idocs')!)
          .getPropertyValue('--idocs-accent')
          .trim(),
      )
    const before = await accent()
    await page.click('[data-palette-btn="blueprint"]')
    expect(await page.locator('.lp-lab').getAttribute('data-palette')).toBe('blueprint')
    expect(await accent()).toBe('#7fd3ff')
    expect(before).not.toBe('#7fd3ff')
    // The matching snippet is the only one on show.
    const shown = await page
      .locator('.lp-lab-code > [data-palette-code]')
      .evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').length)
    expect(shown).toBe(1)
    await close()
  })

  it('shows the real CLI output, the icon wall and the feature links', async () => {
    const { page, close } = await open('/')
    expect(await page.locator('.lp-term').textContent()).toContain('Unknown icon "strpe"')
    expect(await page.locator('.lp-wall li').count()).toBe(24)
    expect(await page.locator('.lp-wall li svg').count()).toBe(24)
    expect(await page.locator('.lp-spec a').count()).toBe(12)
    await close()
  })

  it('copies the install command from the hero', async () => {
    const { page, close } = await open('/')
    await page.click('.lp-hero [data-copy]')
    await page.waitForSelector('.lp-hero [data-copy][data-done="true"]')
    expect(await page.locator('.lp-hero [data-copy]').getAttribute('data-copy')).toBe(
      'npm create idocs@latest my-docs',
    )
    await close()
  })

  it('switches theme, and the docs open in the same theme', async () => {
    const { page, close } = await open('/')
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    await page.click('[data-theme-toggle]')
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    expect(await page.evaluate(() => localStorage.getItem('starlight-theme'))).toBe('dark')
    await page.click('.lp-nav a:has-text("Docs")')
    await page.waitForURL('**/guides/introduction/')
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    await close()
  })

  it('links every nav item, call to action and feature to a page that exists', async () => {
    const { page, close } = await open('/')
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).pathname))])
    expect(hrefs.length).toBeGreaterThan(15)
    for (const href of hrefs) {
      const res = await page.request.get(`${BASE}${href}`)
      expect(res.status(), href).toBe(200)
    }
    await close()
  })

  it('fits a phone without scrolling sideways', async () => {
    const { page, problems, close } = await open('/', { width: 390, height: 844 })
    // The diagram loads when it is seen, and on a phone it starts below the fold.
    await reveal(page, '.lp-stage')
    await page.waitForSelector('.lp-hero [data-node]')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    expect(problems).toEqual([])
    await close()
  })
})
