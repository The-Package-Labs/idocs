import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
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

/**
 * Every fenced code block becomes a command: the block, and an empty place after it where the
 * viewer puts Copy and the fields for its placeholders. The placeholders are marked here, once,
 * so the viewer does not scan text; without script the block is still an ordinary one.
 */
function commandBlocks() {
  const wrap = (pre: HastElement): HastElement => {
    const code = pre.children.find((c) => isElement(c, 'code'))
    if (!code || !isElement(code)) return pre
    const lang = classesOf(code)
      .find((c) => c.startsWith('language-'))
      ?.slice('language-'.length)
    const only = code.children.every((c) => c.type === 'text')
    let vars = false
    if (only && takesPlaceholders(lang, code.data?.meta)) {
      const text = code.children.map((c) => (c as HastText).value).join('')
      // Rewritten even with no placeholder in it: an escape (`\{x}`) loses its backslash here.
      const segments = splitPlaceholders(text)
      vars = segments.some((s) => s.kind === 'var')
      code.children = segments.map(
        (s): HastNode =>
          s.kind === 'text'
            ? { type: 'text', value: s.text }
            : {
                type: 'element',
                tagName: 'span',
                properties: { className: ['idocs-ph'], dataKey: s.key, dataRaw: s.raw },
                children: [{ type: 'text', value: s.raw }],
              },
      )
    }
    return {
      type: 'element',
      tagName: 'div',
      properties: {
        className: ['idocs-cmd'],
        dataIdocsCmd: '',
        ...(lang ? { dataLang: lang } : {}),
        // The header strip with Fill in needs room above the first line.
        ...(vars ? { dataVars: '' } : {}),
      },
      children: [
        pre,
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['idocs-cmd-ui'] },
          children: [],
        },
      ],
    }
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
