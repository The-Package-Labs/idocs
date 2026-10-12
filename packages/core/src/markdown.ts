import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { highlightSegments, languageLabel } from './highlight'
import { splitPlaceholders, takesPlaceholders } from './placeholders'

// The slice of hast this file touches. @types/hast is not a dependency of ours.
interface HastText {
  type: 'text'
  value: string
}
interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: HastNode[]
  data?: { meta?: string }
}
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] }
interface HastRoot {
  type: 'root'
  children: HastNode[]
}

const isElement = (n: HastNode, tag?: string): n is HastElement =>
  n.type === 'element' && (tag === undefined || (n as HastElement).tagName === tag)

const classesOf = (el: HastElement): string[] => {
  const c = el.properties.className
  return Array.isArray(c) ? c.map(String) : typeof c === 'string' ? c.split(/\s+/) : []
}

/** `title="Install"` in the info string of a fence. */
const titleOf = (meta: string | undefined): string | undefined => {
  const m = meta?.match(/\btitle=(?:"([^"]*)"|'([^']*)')/)
  return m?.[1] ?? m?.[2]
}

const el = (
  tagName: string,
  properties: Record<string, unknown>,
  children: HastNode[] = [],
): HastElement => ({ type: 'element', tagName, properties, children })

/**
 * Every fenced code block becomes a command: a frame with the language in a header, the code in
 * colour, and two empty places the viewer fills (the buttons in the header, the fields under the
 * code). The placeholders are marked here, once, so the viewer does not scan text; without script
 * the block is still an ordinary, coloured one.
 */
function commandBlocks() {
  const wrap = (pre: HastElement): HastElement => {
    const code = pre.children.find((c) => isElement(c, 'code'))
    if (!code || !isElement(code)) return pre
    const lang = classesOf(code)
      .find((c) => c.startsWith('language-'))
      ?.slice('language-'.length)
    const title = titleOf(code.data?.meta)
    if (code.children.every((c) => c.type === 'text')) {
      const text = code.children.map((c) => (c as HastText).value).join('')
      // An escape (`\{x}`) loses its backslash here, so the text is rewritten even without a placeholder.
      const segments = takesPlaceholders(lang, code.data?.meta)
        ? splitPlaceholders(text)
        : [{ kind: 'text' as const, text }]
      code.children = highlightSegments(lang, segments).map((piece): HastNode => {
        if (piece.kind === 'var') {
          const { key, raw } = piece.segment
          return el('span', { className: ['idocs-ph'], dataKey: key, dataRaw: raw }, [
            { type: 'text', value: raw },
          ])
        }
        return piece.cls
          ? el('span', { className: [`hl-${piece.cls}`] }, [{ type: 'text', value: piece.text }])
          : { type: 'text', value: piece.text }
      })
    }
    return el(
      'div',
      { className: ['idocs-cmd'], dataIdocsCmd: '', ...(lang ? { dataLang: lang } : {}) },
      [
        el('div', { className: ['idocs-cmd-head'] }, [
          el('span', { className: ['idocs-cmd-lang'] }, [
            { type: 'text', value: languageLabel(lang) },
          ]),
          ...(title
            ? [el('span', { className: ['idocs-cmd-title'] }, [{ type: 'text', value: title }])]
            : []),
          el('div', { className: ['idocs-cmd-bar'] }),
        ]),
        pre,
        el('div', { className: ['idocs-cmd-panel'] }),
      ],
    )
  }
  const walk = (node: HastNode) => {
    if (!('children' in node) || !node.children) return
    node.children = node.children.map((c) => {
      if (isElement(c, 'pre')) return wrap(c)
      walk(c)
      return c
    })
  }
  return (tree: HastRoot) => walk(tree)
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // Raw HTML in markdown is dropped on purpose: compiled docs are injected into the page.
  .use(remarkRehype)
  .use(commandBlocks)
  .use(rehypeStringify)

export function renderMarkdown(md: string): string {
  const body = stripFrontmatter(md).trim()
  if (!body) return ''
  return String(processor.processSync(body))
}

export function stripFrontmatter(md: string): string {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return m ? md.slice(m[0].length) : md
}
