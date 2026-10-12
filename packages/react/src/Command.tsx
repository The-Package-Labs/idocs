import {
  fillSegments,
  type PlaceholderSegment,
  placeholdersOf,
  shownPlaceholder,
  splitPlaceholders,
  unsetPlaceholders,
} from '@the-package-labs/idocs-core'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
  for (const n of block.querySelector('pre > code')?.childNodes ?? []) {
    const el = n as HTMLElement
    const { key, raw } = el.dataset ?? {}
    if (el.nodeType === 1 && el.classList.contains('idocs-ph') && key && raw) {
      out.push({ kind: 'var', key, raw, name: raw.slice(1, -1) })
    } else {
      push(n.textContent ?? '')
    }
  }
  return out
}

interface ControlsProps {
  segments: PlaceholderSegment[]
  open: boolean
  /** The placeholder the reader pointed at, to put the cursor in its field. */
  focusKey?: string
  onOpenChange: (open: boolean) => void
}

/**
 * Copy, and a way to give the placeholders of the command their values first. The fields open
 * under the command, not over it, so a narrow drawer or a list that scrolls never clips them.
 */
export function CommandControls({ segments, open, focusKey, onOpenChange }: ControlsProps) {
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

  // A step row or a list around this block acts on clicks and on Space; typing here is not that.
  const keep = { onClick: (e: { stopPropagation(): void }) => e.stopPropagation() }

  return (
    <div className="idocs-cmd-ctl" {...keep} onKeyDown={(e) => e.stopPropagation()}>
      <div className="idocs-cmd-bar">
        {fields.length > 0 && (
          <button
            ref={opener}
            type="button"
            className={cx('idocs-cmd-btn', open && 'is-on')}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => onOpenChange(!open)}
            title="Give the placeholders their values, then copy"
          >
            <SlidersIcon />
            <span>Fill in</span>
            {unset > 0 && <b className="idocs-cmd-count">{unset}</b>}
          </button>
        )}
        <button
          type="button"
          className={cx('idocs-cmd-btn', copied === 'copied' && 'is-done')}
          onClick={copy}
          title={copied === 'copied' ? 'Copied' : 'Copy'}
        >
          {copied === 'copied' ? <CheckIcon /> : <CopyIcon />}
          <span className={cx(fields.length === 0 && copied === null && 'idocs-cmd-quiet')}>
            {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Press Ctrl+C' : 'Copy'}
          </span>
        </button>
        <span className="idocs-cmd-live" role="status" aria-live="polite">
          {copied === 'copied' ? 'Copied to the clipboard' : ''}
        </span>
      </div>

      {open && (
        <div
          ref={panel}
          id={panelId}
          className="idocs-cmd-fill"
          role="group"
          aria-label="Values for this command"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        >
          {fields.map((f) => (
            <label key={f.key} className="idocs-cmd-field">
              <span className="idocs-cmd-name">
                {f.name}
                {f.secret && <em title="Kept in this tab only; never saved">secret</em>}
              </span>
              <input
                data-key={f.key}
                type={f.secret ? 'password' : 'text'}
                value={vars[f.key] ?? ''}
                placeholder={f.raw}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                onChange={(e) => store.set(f.key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void copy()
                  }
                }}
              />
            </label>
          ))}
          <div className="idocs-cmd-actions">
            <button type="button" className="idocs-cmd-btn is-primary" onClick={copy}>
              <CopyIcon />
              <span>Copy with these values</span>
            </button>
            <button
              type="button"
              className="idocs-cmd-btn"
              onClick={() => store.clear(fields.map((f) => f.key))}
            >
              Clear
            </button>
            {fields.some((f) => f.secret) && (
              <span className="idocs-cmd-note">Secrets stay in this tab and are not saved.</span>
            )}
          </div>
        </div>
      )}
    </div>
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
  const vars = useVars()
  const [open, setOpen] = useState(false)
  const [focusKey, setFocusKey] = useState<string>()
  const hasVars = segments.some((s) => s.kind === 'var')
  const parts = useMemo(() => segments.map((s, at) => ({ s, id: at })), [segments])

  return (
    <div className="idocs idocs-cmd" data-lang={lang} {...(hasVars ? { 'data-vars': '' } : {})}>
      {title && <div className="idocs-cmd-title">{title}</div>}
      <pre>
        <code>
          {parts.map(({ s, id }) => {
            if (s.kind === 'text') return s.text
            const shown = shownPlaceholder(s, vars)
            const pick = () => {
              setFocusKey(s.key)
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
      <div className="idocs-cmd-ui">
        <CommandControls
          segments={segments}
          open={open}
          focusKey={focusKey}
          onOpenChange={(o) => {
            setOpen(o)
            if (!o) setFocusKey(undefined)
          }}
        />
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
