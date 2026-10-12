import type { CompiledDiagram, CompiledView } from '@the-package-labs/idocs-core'
import { type KeyboardEvent, useId } from 'react'
import { htmlText } from './util'

export type SideTab = 'outline' | 'views'

const LABELS: Record<SideTab, string> = {
  outline: 'Outline',
  views: 'Views',
}

/** How wide the panel is and how far it sits from the frame's edge, in px (see `.idocs-panel`). */
export const PANEL_WIDTH = 312
export const PANEL_GAP = 10

interface Props {
  diagram: CompiledDiagram
  view: CompiledView
  onView: (id: string) => void
  tab: SideTab
  tabs: SideTab[]
  onTab: (tab: SideTab) => void
  open: boolean
  onOpen: (open: boolean) => void
  /** The tree of nodes and connections, built by whoever owns the selection it reflects. */
  outline: React.ReactNode
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

const chevron = (open: boolean) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {open ? <path d="M9.5 3.5 5 8l4.5 4.5" /> : <path d="M6.5 3.5 11 8l-4.5 4.5" />}
  </svg>
)

/** The panel's own mark when it is folded: a window with a column on its left. */
const panelIcon = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="2.5" y="3" width="11" height="10" rx="2" />
    <path d="M6.5 3v10M4 6h1M4 8h1M4 10h1" />
  </svg>
)

/**
 * What there is to look at, floating inside the viewport like the panels of a diagram editor: the
 * outline of nodes and connections, and the views. Scenarios and their player are not here but
 * in the bar under the picture. It folds to a button.
 */
export function Panel({ diagram, view, onView, tab, tabs, onTab, open, onOpen, outline }: Props) {
  const uid = useId().replace(/:/g, '')

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const step = keys[e.key]
    if (step === undefined) return
    e.preventDefault()
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!
    onTab(next)
    document.getElementById(`${uid}-tab-${next}`)?.focus()
  }

  if (!open) {
    return (
      <aside
        className="idocs-panel is-folded"
        aria-label="Diagram panel"
        style={{ '--idocs-panel-w': `${PANEL_WIDTH}px` } as React.CSSProperties}
      >
        <button
          type="button"
          className="idocs-panel-fold"
          aria-label="Show the panel"
          title="Show the panel"
          onClick={() => onOpen(true)}
        >
          {panelIcon}
        </button>
      </aside>
    )
  }

  return (
    <aside
      className="idocs-panel"
      aria-label="Diagram panel"
      style={{ '--idocs-panel-w': `${PANEL_WIDTH}px` } as React.CSSProperties}
    >
      <div className="idocs-panel-head">
        <div className="idocs-panel-tabs" role="tablist" aria-label="Panel" onKeyDown={onKey}>
          {tabs.map((t) => (
            <button
              key={t}
              id={`${uid}-tab-${t}`}
              type="button"
              role="tab"
              className="idocs-panel-tab"
              aria-selected={t === tab}
              aria-controls={`${uid}-panel`}
              tabIndex={t === tab ? 0 : -1}
              onClick={() => onTab(t)}
            >
              {LABELS[t]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="idocs-panel-fold"
          aria-label="Hide the panel"
          title="Hide the panel"
          onClick={() => onOpen(false)}
        >
          {chevron(true)}
        </button>
      </div>

      <div
        className="idocs-panel-body"
        role="tabpanel"
        id={`${uid}-panel`}
        aria-labelledby={`${uid}-tab-${tab}`}
      >
        {tab === 'outline' && outline}

        {tab === 'views' && (
          <div className="idocs-scn-list" role="group" aria-label="Views">
            {diagram.views.map((v) => {
              const n = diagram.scenarios.filter((s) => s.view === v.id).length
              return (
                <button
                  key={v.id}
                  type="button"
                  className="idocs-scn"
                  aria-pressed={v.id === view.id}
                  onClick={() => onView(v.id)}
                >
                  <span className="idocs-scn-title">{v.title}</span>
                  <span className="idocs-scn-meta">
                    {count(v.nodeIds.length, 'node')}
                    {n ? ` · ${count(n, 'scenario')}` : ''}
                  </span>
                  {v.summaryHtml && (
                    <span className="idocs-scn-sum">{htmlText(v.summaryHtml)}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
