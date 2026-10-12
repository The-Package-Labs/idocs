import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Locator, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'
import { waitForStep } from './panel'

const PORT = 4508
const BASE = `http://localhost:${PORT}`
const PAGE = '/format/defaults/'

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

/** The two embeds of the same diagram on the page: as the file says, and as a page asks. */
async function open(path = PAGE, width = 1440) {
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
  const diagrams = page.locator('[data-diagram="ref-defaults"]')
  const wake = async (d: Locator) => {
    await d.scrollIntoViewIfNeeded()
    await d.locator('.idocs-panel').waitFor()
  }
  const plain = diagrams.nth(0)
  const asked = diagrams.nth(1)
  return { page, problems, plain, asked, wake, close: () => ctx.close() }
}

/** The sequence diagram itself: its header icons are svgs inside it too. */
const SEQUENCE = '.idocs-seq svg[aria-label^="Sequence diagram"]'

const hashOf = (page: Page) => page.evaluate(() => location.hash)

/** Choose a scenario from the menu on the bar of one of the two diagrams on the page. */
async function choose(d: Locator, title: string) {
  await d.locator('.idocs-sel-btn').click()
  await d
    .locator('.idocs-sel-item')
    .filter({ has: d.page().locator('.idocs-sel-title', { hasText: new RegExp(`^${title}$`) }) })
    .click()
}

describe('a diagram that says how it opens', () => {
  it('opens on its scenario, in the mode it names, with the panel folded and the bar naming it', async () => {
    const { page, problems, plain, wake, close } = await open()
    await wake(plain)
    await plain.locator(SEQUENCE).waitFor()
    // Sequence, not flow: the file asked for it.
    expect(await plain.locator('[data-node]').count()).toBe(0)
    expect(await plain.locator('.idocs-seq .seq-title').count()).toBe(4)
    // The panel is folded to its button, and the bar names the scenario that is chosen.
    expect(await plain.locator('.idocs-panel.is-folded').count()).toBe(1)
    expect(await plain.locator('.idocs-sel-label').textContent()).toBe('Sign in')
    // It waits for the reader: the player offers to play, and the bar says what it is about.
    expect(await plain.locator('.idocs-bar .idocs-btn.is-primary').textContent()).toBe('Play')
    expect(await plain.locator('.idocs-bar-note').textContent()).toContain('opens on')
    // A default is not a reader's choice: the address bar is left alone.
    expect(await hashOf(page)).toBe('')
    expect(problems).toEqual([])
    await close()
  })

  it('goes back to what the file says when the overview is chosen and the page is loaded again', async () => {
    const { page, plain, wake, close } = await open()
    await wake(plain)
    await choose(plain, 'Overview')
    await plain.locator('[data-node]').first().waitFor()
    // The overview of a diagram that opens on a scenario is something to link to.
    expect(await hashOf(page)).toBe('#ref-defaults=~')
    await page.reload({ waitUntil: 'networkidle' })
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto'
    })
    const again = page.locator('[data-diagram="ref-defaults"]').nth(0)
    await wake(again)
    await again.locator('[data-node]').first().waitFor()
    expect(await again.locator('.idocs-seq').count()).toBe(0)

    // And choosing the scenario again leaves the address bar as it was.
    await choose(again, 'Sign in')
    await again.locator(SEQUENCE).waitFor()
    expect(await hashOf(page)).toBe('')
    await close()
  })

  it('keeps its mode through another view and another scenario that names none', async () => {
    const { plain, wake, close } = await open()
    await wake(plain)
    await plain.getByRole('button', { name: 'Show the panel' }).click()
    await plain.locator('.idocs-panel-tab', { hasText: 'Views' }).click()
    await plain.locator('.idocs-scn-title', { hasText: 'Auth only' }).click()
    await choose(plain, 'Rotate signing keys')
    // The scenario names no mode, so it is drawn in the one the diagram says.
    await plain.locator(SEQUENCE).waitFor()
    expect(await plain.locator('.idocs-seq .seq-title').count()).toBe(2)
    await close()
  })
})

describe('a page that asks for something else', () => {
  it('wins over the file: its view, its mode, and the panel open', async () => {
    const { asked, wake, close } = await open()
    await wake(asked)
    // The default scenario plays on the overview, so on another view nothing is chosen.
    expect(await asked.locator('.idocs-panel.is-folded').count()).toBe(0)
    expect(await asked.locator('.idocs-sel-label').textContent()).toBe('Choose a scenario')
    expect(await asked.locator('.idocs-seq').count()).toBe(0)
    expect(await asked.locator('[data-node]').count()).toBe(3)
    // The mode it asked for is the one a scenario opens in.
    await choose(asked, 'Rotate signing keys')
    await asked.locator('.idocs-story-grid').waitFor()
    await close()
  })
})

describe('a note that does not fit on the bar', () => {
  it('ends with a link to the list of steps, where it is shown whole', async () => {
    const { plain, wake, page, close } = await open(PAGE, 560)
    await wake(plain)
    // Go to the third step, the one with the long note.
    await plain.locator('.idocs-slider').scrollIntoViewIfNeeded()
    const r = await plain.locator('.idocs-slider').boundingBox()
    await page.mouse.click(r!.x + r!.width * 0.4, r!.y + r!.height / 2)
    await waitForStep(page, '[data-diagram="ref-defaults"]')
    const more = plain.locator('.idocs-bar-more')
    await more.waitFor()
    expect(await plain.locator('.idocs-bar-note').textContent()).toContain(
      'finds the user by email',
    )
    await more.click()
    await plain.locator('.idocs-steps-pop').waitFor()
    // Whole, in the list, under the step it belongs to.
    expect(await plain.locator('.idocs-steps-pop .idocs-step-note').allTextContents()).toContain(
      'The auth service finds the user by email and compares the password with the stored hash, never with the password itself. A missing user and a wrong password look the same to the caller, so the answer says nothing about which emails exist.',
    )
    await close()
  })
})
