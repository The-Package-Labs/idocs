import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CompiledDiagram } from '@the-package-labs/idocs-core'
import { loadIconSets } from '@the-package-labs/idocs-core/node'
import { type Browser, chromium, type Page } from 'playwright-core'
import { serve } from '../../../scripts/static-server.mjs'
import { compileFolder } from '../src/model/compile'
import { lazyIconResolver } from '../src/model/icons'
import { nodeFs } from '../src/model/sources'
import { previewHtml } from '../src/preview/html'
import type { Problem, ToWebview } from '../src/preview/protocol'

export const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const repoRoot = resolve(extensionRoot, '../..')

const icons = lazyIconResolver(loadIconSets)

export function compileExample(name: string): CompiledDiagram {
  const folder = join(repoRoot, 'apps/docs/diagrams', name)
  const outcome = compileFolder(folder, { fs: nodeFs(), icons, refBases: [] })
  if (!outcome?.diagram) throw new Error(`${name} did not compile`)
  return outcome.diagram
}

/** The editor colours of VS Code's Dark+ and Light+ themes, as the webview receives them. */
const THEMES = {
  dark: `--vscode-editor-background:#1e1e1e;--vscode-editor-foreground:#d4d4d4;--vscode-descriptionForeground:#9d9d9d;--vscode-textLink-foreground:#3794ff;--vscode-panel-border:#80808059;--vscode-widget-border:#303031;--vscode-editorWidget-background:#252526;--vscode-list-hoverBackground:#2a2d2e;--vscode-focusBorder:#007fd4;--vscode-editorError-foreground:#f14c4c;--vscode-editorWarning-foreground:#cca700;--vscode-testing-iconPassed:#73c991;--vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Menlo,Monaco,monospace;--vscode-toolbar-hoverBackground:#5a5d5e50;--vscode-icon-foreground:#c5c5c5`,
  light: `--vscode-editor-background:#ffffff;--vscode-editor-foreground:#000000;--vscode-descriptionForeground:#717171;--vscode-textLink-foreground:#006ab1;--vscode-panel-border:#80808059;--vscode-widget-border:#c8c8c8;--vscode-editorWidget-background:#f3f3f3;--vscode-list-hoverBackground:#e8e8e8;--vscode-focusBorder:#0090f1;--vscode-editorError-foreground:#e51400;--vscode-editorWarning-foreground:#bf8803;--vscode-testing-iconPassed:#388a34;--vscode-font-family:-apple-system,BlinkMacSystemFont,sans-serif;--vscode-font-size:13px;--vscode-editor-font-family:Menlo,Monaco,monospace;--vscode-toolbar-hoverBackground:#b8b8b850;--vscode-icon-foreground:#424242`,
}

export interface Harness {
  page: Page
  /** Messages the webview posted to the extension. */
  sent(): Promise<unknown[]>
  /** Send the webview a message, as the extension does. */
  post(message: ToWebview): Promise<void>
  /** Errors from the page: exceptions, console errors and CSP violations. */
  problems: string[]
  close(): Promise<void>
}

export interface Server {
  url: string
  /** The preview page as the extension builds it. */
  html: string
  stop(): Promise<void>
  browser: Browser
}

/** Build the webview, serve it as the extension would, and start Chrome. */
export async function start(port: number): Promise<Server> {
  execFileSync('node', ['scripts/build.mjs'], { cwd: extensionRoot, stdio: 'ignore' })
  const dir = mkdtempSync(join(tmpdir(), 'idocs-webview-'))
  mkdirSync(join(dir, 'dist/webview'), { recursive: true })
  for (const f of ['main.js', 'main.css']) {
    copyFileSync(join(extensionRoot, 'dist/webview', f), join(dir, 'dist/webview', f))
  }
  const base = `http://localhost:${port}`
  // The same page the extension builds, content security policy included.
  const html = previewHtml({
    nonce: 'test-nonce',
    cspSource: base,
    script: `${base}/dist/webview/main.js`,
    style: `${base}/dist/webview/main.css`,
    title: 'idocs preview',
  })
  writeFileSync(join(dir, 'index.html'), html)
  const server = await serve(dir, port)
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' })
  return {
    url: base,
    html,
    browser,
    stop: async () => {
      await browser.close()
      await server.close()
    },
  }
}

export async function open(
  server: Server,
  {
    theme = 'dark',
    width = 1100,
    height = 800,
    fullscreen = true,
  }: { theme?: 'dark' | 'light'; width?: number; height?: number; fullscreen?: boolean } = {},
): Promise<Harness> {
  const context = await server.browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
  })
  const page = await context.newPage()
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`))
  page.on('console', (m) => {
    // A missing favicon shows up as a failed resource load; real failures are caught below.
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
      problems.push(`console: ${m.text()}`)
    }
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) {
      problems.push(`${r.status()} ${r.url()}`)
    }
  })

  // VS Code sets its theme variables on <html> and its theme kind on <body> before any script runs.
  const cls = theme === 'dark' ? 'vscode-dark' : 'vscode-light'
  await page.route(`${server.url}/`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: server.html
        .replace('<html lang="en">', `<html lang="en" style="${THEMES[theme]}">`)
        .replace('<body>', `<body class="${cls}">`),
    }),
  )

  // VS Code's webview iframe is not given the full screen permission; the page learns that here.
  if (!fullscreen) {
    await page.addInitScript(() => {
      Object.defineProperty(document, 'fullscreenEnabled', { value: false })
    })
  }

  await page.addInitScript(() => {
    const sent: unknown[] = []
    window.__sent = sent
    window.acquireVsCodeApi = () => ({
      postMessage: (m) => sent.push(m),
      getState: () => window.__state ?? null,
      setState: (s) => {
        window.__state = s
      },
    })
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  await page.goto(`${server.url}/`)
  await page.waitForFunction(() =>
    window.__sent?.some((m) => (m as { type?: string }).type === 'ready'),
  )

  return {
    page,
    problems,
    sent: () => page.evaluate(() => window.__sent),
    post: (message) => page.evaluate((m) => window.postMessage(m, '*'), message as never),
    close: () => context.close(),
  }
}

export function message(
  diagram: CompiledDiagram | null,
  options: {
    problems?: Problem[]
    stale?: boolean
    locked?: boolean
    folder?: string
    /** The diagrams its nodes open, by name. */
    nested?: Record<string, CompiledDiagram>
  } = {},
): ToWebview {
  return {
    type: 'diagram',
    name: diagram?.name ?? 'hello',
    folder: options.folder ?? '/p/diagrams/hello',
    diagram,
    nested: options.nested ?? {},
    stale: options.stale ?? false,
    problems: options.problems ?? [],
    locked: options.locked ?? false,
  }
}
