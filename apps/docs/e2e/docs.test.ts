import { fileURLToPath } from 'node:url'
import { type Browser, chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'

const PORT = 4503
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

async function open(path: string, width = 1440) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) problems.push(m.text())
  })
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  return { page, problems, close: () => ctx.close() }
}

describe('documentation navigation', () => {
  it('lists every section as a group with its pages as sub-pages', async () => {
    const { page, close } = await open('/format/nodes/')
    const groups = await page
      .locator('ul.top-level > li > details > summary .large')
      .allTextContents()
    expect(groups.map((g) => g.trim())).toEqual([
      'Start here',
      'Diagram format',
      'Scenarios',
      'Layout',
      'Customize',
      'Embed and publish',
      'AI agents',
      'Examples',
      'Reference',
      'Project',
    ])
    const format = page
      .locator('ul.top-level > li > details', { hasText: 'Diagram format' })
      .first()
    const links = await format.locator('a').allTextContents()
    expect(links.map((l) => l.trim())).toEqual([
      'Overview',
      'Nodes',
      'Groups',
      'Edges',
      'Views',
      'Nested diagrams',
      'Kinds',
      'Node docs',
    ])
    expect(await format.locator('a[aria-current="page"]').textContent()).toContain('Nodes')
    await close()
  })

  it('opens the group that holds the current page, even when it starts collapsed', async () => {
    const { page, close } = await open('/reference/cli/')
    const reference = page.locator('ul.top-level > li > details', {
      hasText: 'Errors and warnings',
    })
    expect(await reference.first().getAttribute('open')).not.toBeNull()
    await close()
  })

  it('renders a live diagram on a reference page and plays it', async () => {
    const { page, problems, close } = await open('/scenarios/steps/')
    await page.waitForSelector('[data-node]')
    expect(await page.locator('[data-node]').count()).toBe(7)
    await page.click('.idocs-chip-btn:has-text("Parallel steps")')
    await page.waitForSelector('.idocs-packet', { state: 'attached', timeout: 10_000 })
    expect(problems).toEqual([])
    await close()
  })

  it('applies a palette from the theming guide to the diagram in its tab', async () => {
    const { page, problems, close } = await open('/customize/theming/')
    await page.getByRole('tab', { name: 'Blueprint' }).click()
    const panel = page.locator('[role="tabpanel"]:visible')
    await panel.locator('[data-node]').first().waitFor()
    const bg = await panel
      .locator('.idocs')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).toBe('rgb(10, 37, 64)')
    expect(problems).toEqual([])
    await close()
  })

  it('shows the tutorial files with the lines each step adds marked', async () => {
    const { page, close } = await open('/guides/first-diagram/')
    expect(await page.locator('.expressive-code').count()).toBeGreaterThanOrEqual(4)
    expect(await page.locator('.expressive-code .ins').count()).toBeGreaterThan(5)
    await close()
  })

  it('has a search index', async () => {
    const res = await fetch(`${BASE}/pagefind/pagefind.js`)
    expect(res.status).toBe(200)
  })

  it('does not scroll sideways on a phone', async () => {
    for (const path of ['/guides/introduction/', '/reference/schema/', '/format/groups/']) {
      const { page, close } = await open(path, 390)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, path).toBeLessThanOrEqual(0)
      await close()
    }
  })
})
