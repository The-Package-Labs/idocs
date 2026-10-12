import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '../../../scripts/static-server.mjs'
import { pick } from './panel'

const PORT = 4504
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

async function open(width = 1440) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    colorScheme: 'light',
  })
  const page = await context.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  await page.goto(`${BASE}/playground/`)
  await page.waitForSelector('[data-node="api"]')
  await ready(page)
  return { page, problems, close: () => context.close() }
}
async function ready(page: Page) {
  await page.waitForFunction(() =>
    document.querySelector('.pg-status')?.textContent?.includes('Up to date'),
  )
}
const editor = (page: Page) => page.getByRole('textbox', { name: 'Diagram YAML', exact: true })

// The assertions go through the built, static site and real compiler worker.
describe('playground', () => {
  it('renders live edits and keeps the last diagram while invalid YAML is being fixed', async () => {
    const { page, problems, close } = await open()
    expect(await page.locator('[data-node]').count()).toBe(3)
    expect(await page.locator('[data-node] .idocs-icon svg').count()).toBe(3)
    await editor(page).fill('title: Live\nnodes: {hello: {title: Live node, kind: service}}')
    await page.waitForSelector('[data-node="hello"]')
    await editor(page).fill('title: [broken\nnodes: {}')
    await page.waitForSelector('.pg-diagnostic.pg-error')
    expect(await page.locator('[data-node="hello"]').count()).toBe(1)
    expect(await page.locator('.pg-preview-notice').textContent()).toContain('last valid')
    await page.getByRole('button', { name: /Line / }).first().click()
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === 'Diagram YAML',
    )
    await editor(page).fill('title: Fixed\nnodes: {fixed: Fixed}')
    await page.waitForSelector('[data-node="fixed"]')
    await ready(page)
    expect(await page.locator('.pg-diagnostic.pg-error').count()).toBe(0)
    expect(problems).toEqual([])
    await close()
  })

  it('edits diagram nodes visually and generates matching YAML, with undo and redo', async () => {
    const { page, problems, close } = await open()
    await page.locator('[data-node="api"]').click()
    await page.getByLabel('Title', { exact: true }).fill('Profile API')
    await ready(page)
    expect(await page.locator('[data-node="api"]').textContent()).toContain('Profile API')
    await page.getByLabel('Color', { exact: true }).selectOption('teal')
    await page.getByRole('button', { name: 'YAML', exact: true }).click()
    expect(await editor(page).inputValue()).toContain('Profile API')
    expect(await editor(page).inputValue()).toContain('family: teal')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    expect(await editor(page).inputValue()).not.toContain('family: teal')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    expect(await editor(page).inputValue()).toContain('family: teal')
    expect(problems).toEqual([])
    await close()
  })

  it('builds a blank diagram with nodes, groups and connections', async () => {
    const { page, problems, close } = await open()
    await page.getByLabel('Example diagram').selectOption('blank')
    await page.getByRole('button', { name: 'Visual builder', exact: true }).click()
    await page.getByRole('button', { name: '+ Add node', exact: true }).click()
    await page.waitForSelector('[data-node="service"]')
    await page.getByLabel('New node kind').selectOption('database')
    await page.getByRole('button', { name: '+ Add node', exact: true }).click()
    await page.waitForSelector('[data-node="database"]')
    await page.getByRole('button', { name: 'Groups', exact: true }).click()
    await page.getByRole('button', { name: '+ Add group', exact: true }).click()
    await page.getByLabel('Label', { exact: true }).fill('Backend')
    await page.locator('[data-node="service"]').click()
    await page.getByLabel('Group', { exact: true }).selectOption('group')
    await page.waitForSelector('.idocs-zone')
    await page.getByRole('button', { name: 'Connections', exact: true }).click()
    await page.getByRole('button', { name: '+ Add connection', exact: true }).click()
    await page.getByLabel('Connection label', { exact: true }).fill('SQL query')
    await page.getByLabel('Connection kind').selectOption('data')
    await ready(page)
    await page.getByRole('button', { name: 'YAML', exact: true }).click()
    const source = await editor(page).inputValue()
    expect(source).toContain('Backend')
    expect(source).toContain('in: group')
    expect(source).toContain('SQL query')
    expect(source).toContain('kind: data')
    expect(await page.locator('[data-node]').count()).toBe(2)
    expect(problems).toEqual([])
    await close()
  })

  it('deletes nodes with their connections and supports keyboard history', async () => {
    const { page, close } = await open()
    await page.locator('[data-node="api"]').click()
    await page.getByRole('button', { name: 'Delete node and its connections', exact: true }).click()
    await ready(page)
    await page.waitForSelector('[data-node="api"]', { state: 'detached' })
    expect(await page.locator('[data-node]').count()).toBe(2)
    await page.getByRole('button', { name: 'YAML', exact: true }).click()
    await editor(page).press('Control+z')
    await page.waitForSelector('[data-node="api"]')
    expect(await page.locator('[data-node]').count()).toBe(3)
    await close()
  })

  it('restores drafts, imports YAML and downloads the current source', async () => {
    const { page, close } = await open()
    const text =
      '# Imported\ntitle: Imported\nnodes: {imported: {title: Imported node, kind: cache}}\n'
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'custom.yaml', mimeType: 'text/yaml', buffer: Buffer.from(text) })
    await page.waitForSelector('[data-node="imported"]')
    await page.waitForFunction(() =>
      localStorage.getItem('idocs-playground-v1')?.includes('# Imported'),
    )
    await page.reload()
    await page.waitForSelector('[data-node="imported"]')
    expect(await editor(page).inputValue()).toBe(text)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toBe('diagram.yaml')
    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream!) chunks.push(chunk)
    expect(Buffer.concat(chunks).toString()).toBe(text)
    await close()
  })

  it('supports scenario playback and recovers from empty source', async () => {
    const { page, problems, close } = await open()
    await page.getByLabel('Example diagram').selectOption('scenario')
    await pick(page, 'Read a profile')
    await page.waitForSelector('.idocs-bar')
    await editor(page).fill('')
    await page.waitForSelector('.pg-diagnostic.pg-error')
    await page.getByRole('button', { name: 'Visual builder', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Open YAML editor' }).count()).toBe(1)
    await page.getByLabel('Example diagram').selectOption('starter')
    await ready(page)
    expect(problems).toEqual([])
    await close()
  })

  it('fits phones in both editor modes and supports dark theme', async () => {
    const { page, problems, close } = await open(390)
    for (const mode of ['YAML', 'Visual builder']) {
      await page.getByRole('button', { name: mode, exact: true }).click()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0)
    }
    await page.getByRole('button', { name: 'Switch between light and dark' }).click()
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    expect(problems).toEqual([])
    await close()
  })

  it('loads uncommon icons on demand and can retry a failed catalog download', async () => {
    const { page, problems, close } = await open()
    const text = 'title: Icons\nnodes: {circle: {title: Circle, icon: "lucide:circle"}}'
    await page.route('**/playground-icons.json', (route) => route.abort())
    await editor(page).fill(text)
    await page.waitForSelector('.pg-diagnostic.pg-error')
    expect(await page.locator('[data-node]').count()).toBe(3)
    expect(await page.locator('.pg-diagnostics').textContent()).toContain('Failed to fetch')
    await page.unroute('**/playground-icons.json')
    await editor(page).fill(`${text}\n# Retry`)
    await page.waitForSelector('[data-node="circle"]')
    expect(await page.locator('[data-node="circle"] .idocs-icon svg').count()).toBe(1)
    await ready(page)
    expect(await page.locator('.pg-diagnostics').count()).toBe(0)
    expect(problems).toEqual([])
    await close()
  })

  it('discards older results when edits arrive during an icon download', async () => {
    const { page, problems, close } = await open()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/playground-icons.json', async (route) => {
      await gate
      await route.continue()
    })
    const requested = page.waitForRequest('**/playground-icons.json')
    await editor(page).fill('title: Old\nnodes: {old: {icon: "lucide:circle"}}')
    await requested
    await editor(page).fill('title: Latest\nnodes: {latest: {title: Latest edit, kind: service}}')
    release()
    await page.waitForSelector('[data-node="latest"]')
    await ready(page)
    expect(await page.locator('[data-node="old"]').count()).toBe(0)
    expect(problems).toEqual([])
    await close()
  })

  it('continues working when browser storage is unavailable', async () => {
    const context = await browser.newContext()
    await context.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error('Storage disabled')
      }
      Storage.prototype.getItem = () => {
        throw new Error('Storage disabled')
      }
    })
    const page = await context.newPage()
    await page.goto(`${BASE}/playground/`)
    await page.waitForSelector('[data-node="api"]')
    await editor(page).fill('title: Private\nnodes: {private: Private}')
    await page.waitForSelector('[data-node="private"]')
    await context.close()
  })
})
