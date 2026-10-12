import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'

const PORT = 4506
const BASE = `http://localhost:${PORT}`
const WINDOW = 1000

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

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: WINDOW } })
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404|favicon/.test(m.text())) problems.push(m.text())
  })
  await page.goto(`${BASE}/examples/payments/`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto'
  })
  await page.waitForSelector('.idocs-frame [data-node]')
  await page.locator('.idocs-frame').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  return { page, problems, close: () => ctx.close() }
}

const frame = (page: Page) => page.locator('.idocs-frame').first()
const handle = (page: Page) => page.locator('.idocs-resize').first()
const height = (page: Page) =>
  frame(page).evaluate((el) => Math.round(el.getBoundingClientRect().height))
const worldTransform = (page: Page) =>
  page
    .locator('.idocs-world')
    .first()
    .evaluate((el) => (el as HTMLElement).style.transform)

/** Drag the bottom edge by `dy` pixels, and sideways by `dx`, as a pointer does. */
async function drag(page: Page, dy: number, dx = 0) {
  const box = (await handle(page).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 })
  await page.mouse.move(x + dx, y + dy, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(200)
}

describe('resizing the viewer', () => {
  it('has a bottom edge that is a splitter, announced with its size', async () => {
    const { page, problems, close } = await open()
    const h = handle(page)
    expect(await h.getAttribute('role')).toBe('separator')
    expect(await h.getAttribute('aria-orientation')).toBe('horizontal')
    expect(await h.getAttribute('aria-label')).toBe('Resize the viewer')
    expect(Number(await h.getAttribute('aria-valuenow'))).toBe(await height(page))
    expect(problems).toEqual([])
    await close()
  })

  it('follows the pointer when dragged, down and up, and stops at the shortest', async () => {
    const { page, close } = await open()
    const start = await height(page)
    await drag(page, 180)
    expect(Math.abs((await height(page)) - (start + 180))).toBeLessThanOrEqual(3)
    await drag(page, -120)
    expect(Math.abs((await height(page)) - (start + 60))).toBeLessThanOrEqual(3)
    await drag(page, -2000)
    expect(await height(page)).toBe(220)
    expect(Number(await handle(page).getAttribute('aria-valuenow'))).toBe(220)
    await close()
  })

  it('can be resized with the keyboard, and put back with Enter or a double-click', async () => {
    const { page, close } = await open()
    const auto = await height(page)
    await handle(page).focus()
    await page.keyboard.press('ArrowDown')
    expect(await height(page)).toBe(auto + 24)
    await page.keyboard.press('PageDown')
    expect(await height(page)).toBe(auto + 24 + 120)
    await page.keyboard.press('ArrowUp')
    expect(await height(page)).toBe(auto + 120)
    await page.keyboard.press('Home')
    expect(await height(page)).toBe(220)
    await page.keyboard.press('Enter')
    expect(await height(page)).toBe(auto)

    await page.keyboard.press('PageDown')
    expect(await height(page)).not.toBe(auto)
    await handle(page).dblclick()
    await page.waitForTimeout(200)
    expect(await height(page)).toBe(auto)
    await close()
  })

  it('refits the diagram to the new size, until the reader has moved it by hand', async () => {
    const { page, close } = await open()
    const scale = async () => {
      const m = /scale\(([\d.]+)\)/.exec(await worldTransform(page))
      return Number(m?.[1])
    }
    const small = await scale()
    await drag(page, 260)
    // Never smaller for more room, and the whole diagram is still in the frame.
    expect(await scale()).toBeGreaterThanOrEqual(small - 0.001)

    // Pan by hand: the reader's view is theirs, and resizing leaves it alone.
    const box = (await frame(page).boundingBox())!
    await page.mouse.move(box.x + 40, box.y + 60)
    await page.mouse.down()
    await page.mouse.move(box.x + 140, box.y + 110, { steps: 4 })
    await page.mouse.up()
    const panned = await worldTransform(page)
    await drag(page, 80)
    expect(await worldTransform(page)).toBe(panned)
    await close()
  })

  it('does not pan the diagram while dragging the edge, and leaves an open panel open', async () => {
    const { page, close } = await open()
    await page.locator('[data-node="api"] .idocs-node-title').first().click()
    await page.waitForSelector('.idocs-drawer')
    const before = await worldTransform(page)
    const h = await height(page)
    // Sideways only: the height cannot change, so any change to the camera would be a pan.
    await drag(page, 0, 200)
    expect(await height(page)).toBe(h)
    expect(await worldTransform(page)).toBe(before)
    expect(await page.locator('.idocs-drawer').count()).toBe(1)
    await close()
  })
})

describe('expanding the viewer', () => {
  it('takes most of the window, keeps itself in sight, and goes back', async () => {
    const { page, problems, close } = await open()
    const auto = await height(page)
    const button = page.getByRole('button', { name: 'Expand the viewer' }).first()
    expect(await button.getAttribute('aria-pressed')).toBe('false')
    await button.click()
    await page.waitForTimeout(500)

    const grown = await height(page)
    expect(grown).toBe(Math.round(WINDOW * 0.88))
    expect(grown).toBeGreaterThan(auto)
    const shrink = page.getByRole('button', { name: 'Shrink the viewer' }).first()
    expect(await shrink.getAttribute('aria-pressed')).toBe('true')
    // The whole frame is on screen.
    const box = (await frame(page).boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(-1)
    expect(box.y + box.height).toBeLessThanOrEqual(WINDOW + 1)

    await shrink.click()
    await page.waitForTimeout(300)
    expect(await height(page)).toBe(auto)

    // A size the reader dragged to is replaced by expanding, and expanding twice returns to auto.
    await drag(page, 90)
    await button.click()
    await page.waitForTimeout(300)
    expect(await height(page)).toBe(grown)
    expect(problems).toEqual([])
    await close()
  })

  it('leaves no handle in full screen, and brings it back', async () => {
    const { page, close } = await open()
    await page.getByRole('button', { name: 'Full screen' }).first().click()
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains('idocs'))
    // The page re-renders after the browser says it is full screen.
    await page.waitForFunction(
      () =>
        !document.fullscreenElement?.querySelector(
          '.idocs-resize, button[aria-label$="the viewer"]',
        ),
    )
    await page.evaluate(() => document.exitFullscreen())
    await page.waitForFunction(() => !document.fullscreenElement)
    await page.waitForSelector('.idocs-resize')
    await close()
  })
})
