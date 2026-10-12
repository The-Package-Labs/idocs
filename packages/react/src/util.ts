const TOKENS = new Set([
  'ink',
  'accent',
  'tunnel',
  'muted',
  'ok',
  'warn',
  'bad',
  'blue',
  'amber',
  'violet',
  'green',
  'teal',
  'red',
  'slate',
])

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** Edge kinds name a theme token (`accent`) or carry any CSS colour. */
export function colorVar(color: string): string {
  return TOKENS.has(color) ? `var(--idocs-${color})` : color
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
export function roman(n: number): string {
  return ROMAN[n] ?? String(n + 1)
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** The words of compiled Markdown, for a short blurb. No DOM, so it also runs while rendering on the server. */
export function htmlText(html: string | undefined, max = 140): string {
  const text = (html ?? '')
    // Block ends are word breaks; inline tags (a bold word before a comma) must not add a space.
    .replace(/<\/(?:p|li|h[1-6]|div|tr|ul|ol)>|<br\s*\/?>/g, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/**
 * Scroll `box` just enough to bring `el` into view with a margin, and never anything else: a
 * list that follows a player must not drag the page along (`scrollIntoView` does).
 */
export function keepInView(el: HTMLElement, box: HTMLElement, margin = 10): void {
  const b = box.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const reduced =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const to = (top: number) => box.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
  if (r.top < b.top + margin) to(box.scrollTop + r.top - b.top - margin)
  else if (r.bottom > b.bottom - margin) to(box.scrollTop + r.bottom - b.bottom + margin)
}

/** Under this width, in px, the panel has no room beside the picture and covers it instead. */
export const NARROW = 640
