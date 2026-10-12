import {
  fillSegments,
  highlightSegments,
  languageLabel,
  type PlaceholderSegment,
  placeholdersOf,
  shownPlaceholder,
  splitPlaceholders,
  unsetPlaceholders,
} from '@the-package-labs/idocs-core'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './util'
import { pageVars, useVars } from './vars'

/** Put text on the clipboard. The fallback is for places the clipboard API is withheld, such as an editor's webview. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fall through to the old way.
  }
  try {
    const box = document.createElement('textarea')
    box.value = text
    box.setAttribute('readonly', '')
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.append(box)
    box.select()
    const ok = document.execCommand('copy')
    box.remove()
    return ok
  } catch {
    return false
  }
}

/** The text of a command block as the compiler marked it. Placeholders are read from their marks, not found again. */
export function segmentsOfBlock(block: HTMLElement): PlaceholderSegment[] {
  const out: PlaceholderSegment[] = []
  const push = (text: string) => {
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += text
    else if (text) out.push({ kind: 'text', text })
  }
  // Colours are spans around the text; a placeholder is the one kind of span that is not walked into.
  const walk = (node: Node) => {
    for (const n of node.childNodes) {
      const el = n as HTMLElement
      if (el.nodeType !== 1) {
        push(n.textContent ?? '')
        continue
      }
      const { key, raw } = el.dataset
      if (el.classList.contains('idocs-ph') && key && raw) {
        out.push({ kind: 'var', key, raw, name: raw.slice(1, -1) })
      } else {
        walk(el)
      }
    }
  }
  const code = block.querySelector('pre > code')
  if (code) walk(code)
  return out
}

/** What a command does when the reader acts on it: shared by the buttons in the header and the fields under the code. */
function useCommand(
  segments: PlaceholderSegment[],
  open: boolean,
  focusKey: string | undefined,
  onOpenChange: (open: boolean) => void,
) {
  const vars = useVars()
  const store = pageVars()
  const fields = useMemo(() => placeholdersOf(segments), [segments])
  const unset = unsetPlaceholders(segments, vars).length
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!open) return
    const inputs = [...(panel.current?.querySelectorAll('input') ?? [])]
    const target =
      inputs.find((i) => i.dataset.key === focusKey) ?? inputs.find((i) => !i.value) ?? inputs[0]
    target?.focus()
  }, [open, focusKey])

  const copy = async () => {
    const ok = await copyText(fillSegments(segments, store.get()).replace(/\n$/, ''))
    setCopied(ok ? 'copied' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), 1800)
  }

  const close = () => {
    onOpenChange(false)
    opener.current?.focus()
  }

  return {
    vars,
    store,
    fields,
    unset,
    copied,
    copy,
    close,
    panel,
    opener,
    panelId,
    open,
    onOpenChange,
  }
}

type Command = ReturnType<typeof useCommand>

// A step row or a list around a block acts on clicks and on Space; typing in a field is not that.
const keep = {
  onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
  onKeyDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
}

/** The icon buttons of the header: fill in the placeholders, and copy. A tooltip says what each does. */
function CommandBar({ c }: { c: Command }) {
  const tip =
    c.copied === 'copied' ? 'Copied!' : c.copied === 'failed' ? 'Press Ctrl+C to copy' : 'Copy'
  return (
    <div className="idocs-cmd-ctl" {...keep}>
      {c.fields.length > 0 && (
        <button
          ref={c.opener}
          type="button"
          className={cx('idocs-cmd-btn', c.open && 'is-on')}
          aria-label="Fill in values"
          aria-expanded={c.open}
          aria-controls={c.panelId}
          data-tip={c.unset > 0 ? `Fill in values · ${c.unset} to set` : 'Fill in values'}
          onClick={() => c.onOpenChange(!c.open)}
        >
          <SlidersIcon />
          {c.unset > 0 && <b className="idocs-cmd-count">{c.unset}</b>}
        </button>
      )}
      <button
        type="button"
        className={cx('idocs-cmd-btn', c.copied === 'copied' && 'is-done')}
        aria-label="Copy"
        data-tip={tip}
        onClick={c.copy}
      >
        {c.copied === 'copied' ? <CheckIcon /> : <CopyIcon />}
      </button>
      <span className="idocs-cmd-live" role="status" aria-live="polite">
        {c.copied === 'copied' ? 'Copied to the clipboard' : ''}
      </span>
    </div>
  )
}

/**
 * The fields of the placeholders. They open under the code, inside the frame, not over it, so a
 * narrow drawer or a list that scrolls never clips them.
 */
function CommandPanel({ c }: { c: Command }) {
  if (!c.open) return null
  return (
    <div className="idocs-cmd-ctl" {...keep}>
      <div
        ref={c.panel}
        id={c.panelId}
        className="idocs-cmd-fill"
        role="group"
        aria-label="Values for this command"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            c.close()
          }
        }}
      >
        {c.fields.map((f) => (
          <label key={f.key} className="idocs-cmd-field">
            <span className="idocs-cmd-name">
              {f.name}
              {f.secret && <em title="Kept in this tab only; never saved">secret</em>}
            </span>
            <input
              data-key={f.key}
              type={f.secret ? 'password' : 'text'}
              value={c.vars[f.key] ?? ''}
              placeholder={f.raw}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              onChange={(e) => c.store.set(f.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void c.copy()
                }
              }}
            />
          </label>
        ))}
        <div className="idocs-cmd-actions">
          <button type="button" className="idocs-cmd-text is-primary" onClick={c.copy}>
            <CopyIcon />
            <span>Copy with these values</span>
          </button>
          <button
            type="button"
            className="idocs-cmd-text"
            onClick={() => c.store.clear(c.fields.map((f) => f.key))}
          >
            Clear
          </button>
          {c.fields.some((f) => f.secret) && (
            <span className="idocs-cmd-note">Secrets stay in this tab and are not saved.</span>
          )}
        </div>
      </div>
    </div>
  )
}

/** For a block the compiler framed: the two components above, put into the places it left for them. */
export function CommandPortals({
  segments,
  bar,
  panel,
  open,
  focusKey,
  onOpenChange,
}: {
  segments: PlaceholderSegment[]
  bar: Element
  panel: Element
  open: boolean
  focusKey?: string
  onOpenChange: (open: boolean) => void
}) {
  const c = useCommand(segments, open, focusKey, onOpenChange)
  return (
    <>
      {createPortal(<CommandBar c={c} />, bar)}
      {createPortal(<CommandPanel c={c} />, panel)}
    </>
  )
}

/** A command written in a page rather than compiled from Markdown: the Astro `<Command>` renders this. */
export function CommandBlock({
  code,
  lang,
  title,
}: {
  code: string
  lang?: string
  title?: string
}) {
  const segments = useMemo(() => splitPlaceholders(code.replace(/\n$/, '')), [code])
  const pieces = useMemo(
    () => highlightSegments(lang, segments).map((piece, id) => ({ piece, id })),
    [lang, segments],
  )
  const vars = useVars()
  const [open, setOpen] = useState(false)
  const [focusKey, setFocusKey] = useState<string>()
  const c = useCommand(segments, open, focusKey, (o) => {
    setOpen(o)
    if (!o) setFocusKey(undefined)
  })

  return (
    <div className="idocs idocs-cmd" data-lang={lang}>
      <div className="idocs-cmd-head">
        <span className="idocs-cmd-lang">{languageLabel(lang)}</span>
        {title && <span className="idocs-cmd-title">{title}</span>}
        <div className="idocs-cmd-bar">
          <CommandBar c={c} />
        </div>
      </div>
      <pre>
        <code>
          {pieces.map(({ piece, id }): ReactNode => {
            if (piece.kind === 'text') {
              return piece.cls ? (
                <span key={id} className={`hl-${piece.cls}`}>
                  {piece.text}
                </span>
              ) : (
                piece.text
              )
            }
            const shown = shownPlaceholder(piece.segment, vars)
            const pick = () => {
              setFocusKey(piece.segment.key)
              setOpen(true)
            }
            return (
              <span
                key={id}
                className="idocs-ph"
                data-state={shown.state}
                role="button"
                tabIndex={0}
                title="Click to set a value"
                onClick={pick}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    pick()
                  }
                }}
              >
                {shown.text}
              </span>
            )
          })}
        </code>
      </pre>
      <div className="idocs-cmd-panel">
        <CommandPanel c={c} />
      </div>
    </div>
  )
}

const icon = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

function CopyIcon() {
  return (
    <svg {...icon}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...icon}>
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  )
}

function SlidersIcon() {
  return (
    <svg {...icon}>
      <path d="M2 4.5h6M11.5 4.5H14M2 11.5h2.5M8 11.5H14" />
      <circle cx="9.7" cy="4.5" r="1.7" />
      <circle cx="6.2" cy="11.5" r="1.7" />
    </svg>
  )
}
