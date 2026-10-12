import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Problem } from '../src/preview/protocol'
import {
  compileExample,
  extensionRoot,
  type Harness,
  message,
  open,
  type Server,
  start,
} from './helpers'

const SHOTS = process.env.IDOCS_SCREENSHOTS
let server: Server

beforeAll(async () => {
  server = await start(4521)
})
afterAll(async () => {
  await server?.stop()
})

async function shot(h: Harness, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await h.page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

const warning: Problem = {
  severity: 'warning',
  message: 'Node "api" cites "src/missing.ts", which does not exist',
  hint: 'The code may have moved. Update the diagram or the reference.',
  file: '/p/diagrams/hello/diagram.yaml',
  label: 'diagram.yaml',
  line: 9,
  col: 12,
}
const error: Problem = {
  severity: 'error',
  message: 'Unknown key "nope"',
  hint: 'Did you mean "node"?',
  file: '/p/diagrams/hello/scenarios/x.yaml',
  label: 'scenarios/x.yaml',
  line: 3,
  col: 5,
}

describe('preview webview', () => {
  it('asks the extension for the diagram when it loads, and says nothing is open until it gets one', async () => {
    const h = await open(server)
    expect((await h.sent())[0]).toEqual({ type: 'ready' })
    await h.post({ type: 'empty', message: 'Open a diagram file to preview it.' })
    await h.page.getByText('Open a diagram file to preview it.').waitFor()
    expect(h.problems).toEqual([])
    await h.close()
  })

  it('draws the diagram it is sent, with icons, under the real content security policy', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello')))
    await h.page.waitForSelector('[data-node="api"]')
    expect(await h.page.locator('[data-node]').count()).toBe(3)
    expect(await h.page.locator('[data-node] .idocs-icon svg').count()).toBe(3)
    expect(await h.page.getByText('Up to date').count()).toBe(1)
    expect(h.problems).toEqual([])
    await shot(h, 'hello-dark')
    await h.close()
  })

  it('draws the larger examples without errors', async () => {
    const h = await open(server, { width: 1400, height: 900 })
    await h.post(message(compileExample('checkout')))
    await h.page.waitForSelector('[data-node]')
    await h.page.waitForTimeout(400)
    expect(await h.page.locator('[data-node]').count()).toBeGreaterThan(8)
    await shot(h, 'checkout-dark')
    expect(h.problems).toEqual([])
    await h.close()
  })

  it('follows the editor theme', async () => {
    const h = await open(server, { theme: 'light' })
    expect(await h.page.evaluate(() => document.documentElement.dataset.theme)).toBe('light')
    await h.post(message(compileExample('hello')))
    await h.page.waitForSelector('[data-node="api"]')
    await shot(h, 'hello-light')
    // VS Code switches the class on <body> when the user changes theme.
    await h.page.evaluate(() => {
      document.body.classList.replace('vscode-light', 'vscode-dark')
    })
    await h.page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
    await h.close()
  })

  it('outlines the node the editor cursor is in without opening its drawer', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello')))
    await h.page.waitForSelector('[data-node="api"]')
    await h.post({ type: 'select', node: 'api' })
    await h.page.waitForSelector('[data-node="api"].is-selected')
    expect(await h.page.locator('.idocs-drawer').count()).toBe(0)
    await shot(h, 'cursor-in-api')
    await h.post({ type: 'select', node: null })
    await h.page.waitForFunction(() => !document.querySelector('[data-node].is-selected'))
    await h.close()
  })

  it('ignores an outline for a node the diagram does not have', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello')))
    await h.page.waitForSelector('[data-node="api"]')
    await h.post({ type: 'select', node: 'a-node-that-was-just-renamed' })
    await h.page.waitForTimeout(150)
    expect(await h.page.locator('[data-node].is-dim').count()).toBe(0)
    expect(await h.page.locator('[data-node].is-selected').count()).toBe(0)
    await h.close()
  })

  it('drops the outline when it is sent a different diagram', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello'), { folder: '/p/diagrams/hello' }))
    await h.page.waitForSelector('[data-node="api"]')
    await h.post({ type: 'select', node: 'api' })
    await h.page.waitForSelector('[data-node="api"].is-selected')
    // Another diagram that also has an `api`: the cursor that outlined it is somewhere else now.
    await h.post(message(compileExample('hello'), { folder: '/p/diagrams/other' }))
    await h.page.waitForFunction(() => !document.querySelector('[data-node].is-selected'))
    await h.close()
  })

  it('keeps the outline when the same diagram is edited', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello')))
    await h.post({ type: 'select', node: 'api' })
    await h.page.waitForSelector('[data-node="api"].is-selected')
    const edited = structuredClone(compileExample('hello'))
    edited.nodes.db!.title = 'Renamed'
    await h.post(message(edited))
    await h.page.locator('[data-node="db"] .idocs-node-title', { hasText: 'Renamed' }).waitFor()
    expect(await h.page.locator('[data-node="api"].is-selected').count()).toBe(1)
    await h.close()
  })

  it('offers full screen only where the page may use it', async () => {
    const allowed = await open(server)
    await allowed.post(message(compileExample('hello')))
    await allowed.page.waitForSelector('[data-node="api"]')
    expect(await allowed.page.getByRole('button', { name: 'Full screen' }).count()).toBe(1)
    await allowed.close()

    const blocked = await open(server, { fullscreen: false })
    await blocked.post(message(compileExample('hello')))
    await blocked.page.waitForSelector('[data-node="api"]')
    expect(await blocked.page.getByRole('button', { name: 'Full screen' }).count()).toBe(0)
    // The other controls are still there.
    expect(await blocked.page.getByRole('button', { name: 'Zoom in' }).count()).toBe(1)
    await blocked.close()
  })

  it('opens the drawer and tells the extension which node was clicked', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello')))
    await h.page.waitForSelector('[data-node="db"]')
    await h.page.locator('[data-node="db"]').click()
    await h.page.waitForSelector('.idocs-drawer')
    expect(await h.sent()).toContainEqual({ type: 'reveal-node', id: 'db' })
    await h.close()
  })

  it('lists problems and takes you to them', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello'), { problems: [warning] }))
    await h.page.waitForSelector('[data-node="api"]')
    await h.page.getByRole('button', { name: /1 warning/ }).click()
    await h.page.getByText('Update the diagram or the reference.').waitFor()
    await shot(h, 'problems')
    await h.page.getByRole('button', { name: /cites "src\/missing.ts"/ }).click()
    expect(await h.sent()).toContainEqual({
      type: 'reveal-problem',
      file: '/p/diagrams/hello/diagram.yaml',
      line: 9,
      col: 12,
    })
    await h.close()
  })

  it('keeps showing the last valid diagram while the text has errors', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello')))
    await h.page.waitForSelector('[data-node="api"]')
    await h.post(message(compileExample('hello'), { problems: [error], stale: true }))
    await h.page.getByText(/1 error · showing the last valid diagram/).waitFor()
    expect(await h.page.locator('[data-node="api"]').count()).toBe(1)
    await h.close()
  })

  it('shows the problems when there is nothing to draw', async () => {
    const h = await open(server)
    await h.post(message(null, { problems: [error], stale: true }))
    await h.page.getByText('Unknown key "nope"').waitFor()
    await h.page.getByText(/nothing to draw/).waitFor()
    await shot(h, 'errors-only')
    await h.close()
  })

  it('keeps the chosen scenario when the diagram is edited', async () => {
    const h = await open(server)
    const diagram = compileExample('hello')
    await h.post(message(diagram))
    await h.page.waitForSelector('[data-node="api"]')
    await h.page.getByRole('button', { name: diagram.scenarios[0]!.title }).click()
    await h.page.waitForSelector('.idocs-player, [aria-label="Playback"]')
    const edited = structuredClone(diagram)
    edited.nodes.api!.title = 'Renamed API'
    await h.post(message(edited))
    await h.page
      .locator('[data-node="api"] .idocs-node-title', { hasText: 'Renamed API' })
      .waitFor()
    expect(
      await h.page
        .getByRole('button', { name: diagram.scenarios[0]!.title })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    await h.close()
  })

  it('toggles the lock and asks for a refresh', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello')))
    await h.page.getByRole('button', { name: 'Lock preview' }).click()
    await h.page.getByRole('button', { name: 'Refresh' }).click()
    const sent = await h.sent()
    expect(sent).toContainEqual({ type: 'toggle-lock' })
    expect(sent).toContainEqual({ type: 'refresh' })
    await h.post({ type: 'lock', locked: true })
    await h.page.getByRole('button', { name: 'Unlock preview' }).waitFor()
    await h.close()
  })

  it('remembers what it shows, so VS Code can restore it', async () => {
    const h = await open(server)
    await h.post(message(compileExample('hello'), { locked: true }))
    await h.page.waitForSelector('[data-node="api"]')
    expect(await h.page.evaluate(() => window.__state)).toEqual({
      folder: '/p/diagrams/hello',
      locked: true,
    })
    await h.close()
  })

  it('looks inside a node that holds a diagram, under the real policy, and comes back', async () => {
    const h = await open(server, { width: 1100, height: 900 })
    const nested = Object.fromEntries(
      ['nest-orders', 'nest-stock', 'payments'].map((n) => [n, compileExample(n)]),
    )
    await h.post(message(compileExample('nest-shop'), { nested }))
    await h.page.waitForSelector('[data-node="orders"]')
    expect(await h.page.locator('[data-level="0"] [data-node] .idocs-node-inside').count()).toBe(2)

    await h.page.locator('[data-level="0"] [data-node="orders"] .idocs-node-inside').click()
    await h.page.waitForSelector('[data-level="1"] [data-node="stock"]')
    expect(await h.page.locator('.idocs-crumb[aria-current="location"]').textContent()).toContain(
      'Order service',
    )
    await shot(h, 'nested-dark')

    // The editor is told about clicks on the diagram being edited, not on one opened from it.
    await h.page.locator('[data-level="1"] [data-node="api"]').click()
    expect((await h.sent()).filter((m) => (m as { type: string }).type === 'reveal-node')).toEqual(
      [],
    )

    await h.page.getByRole('button', { name: /Back to/ }).click()
    await h.page.locator('[data-level="0"]').waitFor({ state: 'visible' })
    expect(h.problems).toEqual([])
    await h.close()
  })

  it('has the paths it needs', () => {
    expect(extensionRoot).toContain('extensions/vscode')
  })
})
