import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/markdown'

const fence = (info: string, body: string) => `\`\`\`${info}\n${body}\n\`\`\``

describe('commands in compiled markdown', () => {
  it('wraps every fenced block and leaves a place for the controls', () => {
    const html = renderMarkdown(fence('sh', 'pnpm install'))
    expect(html).toContain('<div class="idocs-cmd" data-idocs-cmd="" data-lang="sh">')
    expect(html).toContain('<div class="idocs-cmd-ui"></div>')
    expect(html).not.toContain('idocs-ph')
    expect(html).not.toContain('data-vars')
  })

  it('marks placeholders in a command, under one key however they are spelled', () => {
    const html = renderMarkdown(fence('bash', 'git clone https://x/{Owner}/{repo}.git # <you_pat>'))
    expect(html).toContain(
      '<span class="idocs-ph" data-key="owner" data-raw="{Owner}">{Owner}</span>',
    )
    expect(html).toContain('data-key="repo"')
    expect(html).toContain('data-idocs-cmd="" data-lang="bash" data-vars=""')
    expect(html).toContain('data-key="you_pat" data-raw="<you_pat>"')
  })

  it('leaves code languages alone, unless the fence asks', () => {
    expect(renderMarkdown(fence('ts', 'const a = {b}'))).not.toContain('idocs-ph')
    expect(renderMarkdown(fence('ts vars', 'const a = {b}'))).toContain('idocs-ph')
    expect(renderMarkdown(fence('sh novars', 'echo {b}'))).not.toContain('idocs-ph')
  })

  it('drops the backslash of an escaped placeholder and does not mark it', () => {
    const html = renderMarkdown(fence('sh', 'echo \\{literal}'))
    expect(html).toContain('echo {literal}')
    expect(html).not.toContain('idocs-ph')
  })

  it('handles blocks nested in lists and does not wrap one twice', () => {
    const html = renderMarkdown(
      `1. Run it\n\n   ${fence('sh', 'echo {x}').replace(/\n/g, '\n   ')}\n`,
    )
    expect(html.match(/data-idocs-cmd/g)).toHaveLength(1)
    expect(html).toContain('idocs-ph')
  })

  it('does not touch inline code', () => {
    const html = renderMarkdown('Use `git clone {repo}` here.')
    expect(html).not.toContain('idocs-cmd')
    expect(html).not.toContain('idocs-ph')
  })
})
