import { fileURLToPath } from 'node:url'
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Locator,
  type Page,
} from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'

const PORT = 4511
const BASE = `http://localhost:${PORT}`
const PAGE = '/customize/commands/'

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

async function open(ctx: BrowserContext) {
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !/404|favicon/.test(m.text())) {
      problems.push(m.text())
    }
  })
  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto'
  })
  return { page, problems }
}

const context = () =>
  browser.newContext({
    viewport: { width: 1280, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    baseURL: BASE,
  })

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

/** The nth command written in the page with <Command>. */
const command = (page: Page, n: number) => page.locator('.idocs-command .idocs-cmd').nth(n)

// The buttons are icons: they are found by what they are called, and the tooltip says the same.
const fillIn = (cmd: Locator) => cmd.getByRole('button', { name: 'Fill in values' })
const copyButton = (cmd: Locator) => cmd.getByRole('button', { name: 'Copy', exact: true })

describe('a command looks like a code block', () => {
  it('names its language, colours the code, and shows a title', async () => {
    const ctx = await context()
    const { page, problems } = await open(ctx)
    const first = command(page, 0)
    await first.scrollIntoViewIfNeeded()
    expect(await first.locator('.idocs-cmd-lang').innerText()).toBe('Shell')
    expect(await first.locator('.hl-keyword').first().innerText()).toBe('git')
    // The colours are real: a command is not the colour of the text around it.
    const [command_, text] = await Promise.all([
      first
        .locator('.hl-keyword')
        .first()
        .evaluate((e) => getComputedStyle(e).color),
      first.locator('pre').evaluate((e) => getComputedStyle(e).color),
    ])
    expect(command_).not.toBe(text)

    const second = command(page, 1)
    expect(await second.locator('.idocs-cmd-lang').innerText()).toBe('Shell')
    expect(await second.locator('.idocs-cmd-title').innerText()).toBe('Install')
    expect(await second.locator('.hl-flag').first().innerText()).toBe('-H')
    expect(problems).toEqual([])
    await ctx.close()
  })

  it('has icon buttons that say what they do when pointed at', async () => {
    const ctx = await context()
    const { page } = await open(ctx)
    const cmd = command(page, 0)
    await cmd.scrollIntoViewIfNeeded()
    expect(await copyButton(cmd).innerText()).toBe('')
    expect(await copyButton(cmd).getAttribute('data-tip')).toBe('Copy')
    expect(await fillIn(cmd).getAttribute('data-tip')).toBe('Fill in values · 2 to set')
    await copyButton(cmd).hover()
    await page.waitForTimeout(500)
    const shown = await copyButton(cmd).evaluate((e) => getComputedStyle(e, '::after').opacity)
    expect(shown).toBe('1')
    await ctx.close()
  })

  it('colours the code in a diagram too, with the language in the header', async () => {
    const ctx = await context()
    const { page } = await open(ctx)
    const diagram = page.locator('[data-diagram="ref-commands"]')
    await diagram.scrollIntoViewIfNeeded()
    await diagram.locator('[data-node="dev"] .idocs-node-title').first().click()
    const block = diagram.locator('.idocs-drawer .idocs-cmd').first()
    await block.waitFor()
    expect(await block.locator('.idocs-cmd-lang').innerText()).toBe('Shell')
    expect(await block.locator('.hl-keyword').first().innerText()).toBe('git')
    await ctx.close()
  })
})

describe('commands with placeholders', () => {
  it('copies a command as it is, and again with the values the reader filled in', async () => {
    const ctx = await context()
    const { page, problems } = await open(ctx)
    const cmd = command(page, 0)
    await cmd.scrollIntoViewIfNeeded()
    await fillIn(cmd).waitFor()

    // Nothing is set: copying leaves the placeholders as written, and the tooltip confirms it.
    await copyButton(cmd).click()
    await expect.poll(() => copyButton(cmd).getAttribute('data-tip')).toBe('Copied!')
    expect(await clipboard(page)).toBe('git clone https://github.com/{yourname}/{repo}.git')

    // Fill in one, and the command shows it and the count drops.
    await fillIn(cmd).click()
    expect(await cmd.locator('.idocs-cmd-count').innerText()).toBe('2')
    await page.keyboard.type('ada')
    expect(await cmd.locator('.idocs-ph').first().innerText()).toBe('ada')
    expect(await cmd.locator('.idocs-cmd-count').innerText()).toBe('1')

    // Enter in a field copies, and the text keeps the placeholder that is still open.
    await page.keyboard.press('Enter')
    expect(await clipboard(page)).toBe('git clone https://github.com/ada/{repo}.git')

    await cmd.locator('.idocs-cmd-field input').nth(1).fill('widgets')
    await cmd.locator('.idocs-cmd-text.is-primary').click()
    expect(await clipboard(page)).toBe('git clone https://github.com/ada/widgets.git')

    // Escape folds the fields and puts focus back on the button.
    await page.keyboard.press('Escape')
    expect(await cmd.locator('.idocs-cmd-fill').count()).toBe(0)
    expect(problems).toEqual([])
    await ctx.close()
  })

  it('opens the field of the word the reader clicked', async () => {
    const ctx = await context()
    const { page } = await open(ctx)
    const cmd = command(page, 0)
    await cmd.scrollIntoViewIfNeeded()
    await cmd.locator('.idocs-ph').nth(1).click()
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-key'))).toBe('repo')
    await ctx.close()
  })

  it('keeps a secret in the tab: masked on the page, real in the clipboard, never saved', async () => {
    const ctx = await context()
    const { page } = await open(ctx)
    const cmd = command(page, 1)
    await cmd.scrollIntoViewIfNeeded()
    await fillIn(cmd).click()

    const token = cmd.locator('.idocs-cmd-field input[data-key="you_pat"]')
    expect(await token.getAttribute('type')).toBe('password')
    await token.fill('ghp_secret123')
    await cmd.locator('.idocs-cmd-field input[data-key="org"]').fill('acme')

    const shown = await cmd.locator('pre').innerText()
    expect(shown).toContain('••••••••')
    expect(shown).not.toContain('ghp_secret123')
    await cmd.locator('.idocs-cmd-text.is-primary').click()
    expect(await clipboard(page)).toBe(
      'export TOKEN=ghp_secret123\ncurl -H "Authorization: Bearer $TOKEN" https://api.example.com/acme/repos',
    )

    const saved = await page.evaluate(() => JSON.stringify({ ...localStorage }))
    expect(saved).toContain('acme')
    expect(saved).not.toContain('ghp_secret123')

    // A new visit has the name back and not the token.
    await page.reload({ waitUntil: 'networkidle' })
    const again = command(page, 1)
    await again.scrollIntoViewIfNeeded()
    expect(await again.locator('pre').innerText()).toContain('acme')
    expect(await again.locator('pre').innerText()).toContain('<you_pat>')
    await ctx.close()
  })

  it('fills the commands inside a diagram with the same values, and copies them', async () => {
    const ctx = await context()
    const { page, problems } = await open(ctx)
    // Give the name on the page...
    const cmd = command(page, 0)
    await cmd.scrollIntoViewIfNeeded()
    await fillIn(cmd).click()
    await cmd.locator('.idocs-cmd-field input[data-key="yourname"]').fill('ada')

    // ...and open a node of the diagram.
    const diagram = page.locator('[data-diagram="ref-commands"]')
    await diagram.scrollIntoViewIfNeeded()
    await diagram.locator('[data-node="dev"] .idocs-node-title').first().click()
    const inDrawer = diagram.locator('.idocs-drawer .idocs-cmd').first()
    await inDrawer.waitFor()
    await fillIn(inDrawer).waitFor()
    expect(await inDrawer.locator('pre').innerText()).toContain('github.com/ada/{repo}.git')

    // The page's own text is the compiled HTML: copying reads the marks, not what is shown.
    await inDrawer.locator('.idocs-ph[data-key="repo"]').first().click()
    await page.keyboard.type('widgets')
    await inDrawer.locator('.idocs-cmd-text.is-primary').click()
    expect(await clipboard(page)).toBe(
      'git clone https://github.com/ada/widgets.git\ncd widgets\npnpm install\npnpm dev',
    )
    // The one on the page followed.
    expect(await cmd.locator('pre').innerText()).toContain('ada/widgets.git')
    expect(problems).toEqual([])
    await ctx.close()
  })
})
