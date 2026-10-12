import { type PlaceholderSegment, shownPlaceholder } from '@the-package-labs/idocs-core'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CommandPortals, segmentsOfBlock } from './Command'
import { useVars } from './vars'

type Picked = { block: HTMLElement; key?: string }

/**
 * Compiled Markdown, injected. The code blocks in it are commands: the compiler left a place under
 * each for Copy and for the fields of its placeholders, and this puts them there. The HTML itself
 * is never rebuilt; the placeholders in it only change the words they show.
 */
export function Markup({ html, className }: { html: string; className?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const vars = useVars()
  const [blocks, setBlocks] = useState<HTMLElement[]>([])
  const [picked, setPicked] = useState<Picked | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the blocks are those of this html
  useLayoutEffect(() => {
    setPicked(null)
    setBlocks([...(root.current?.querySelectorAll<HTMLElement>('[data-idocs-cmd]') ?? [])])
  }, [html])

  const parts = useMemo<PlaceholderSegment[][]>(() => blocks.map(segmentsOfBlock), [blocks])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `blocks` says the html was read again
  useLayoutEffect(() => {
    for (const el of root.current?.querySelectorAll<HTMLElement>('.idocs-ph') ?? []) {
      const { key, raw } = el.dataset
      if (!key || !raw) continue
      const shown = shownPlaceholder({ kind: 'var', key, raw, name: raw.slice(1, -1) }, vars)
      if (el.textContent !== shown.text) el.textContent = shown.text
      el.dataset.state = shown.state
      el.setAttribute('role', 'button')
      el.setAttribute('title', 'Click to set a value')
      el.tabIndex = 0
    }
  }, [html, vars, blocks])

  const pick = (target: EventTarget | null): boolean => {
    const chip = (target as Element | null)?.closest?.<HTMLElement>('.idocs-ph')
    const block = chip?.closest<HTMLElement>('[data-idocs-cmd]')
    if (!chip || !block) return false
    setPicked({ block, key: chip.dataset.key })
    return true
  }

  return (
    <>
      <div
        ref={root}
        className={className}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={(e) => {
          // A step row around this text seeks on click; picking a placeholder is not that.
          if (pick(e.target)) e.stopPropagation()
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && pick(e.target)) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      />
      {blocks.map((block, i) => {
        const bar = block.querySelector('.idocs-cmd-bar')
        const panel = block.querySelector('.idocs-cmd-panel')
        const segments = parts[i]
        if (!bar || !panel || !segments) return null
        const mine = picked?.block === block
        return (
          <CommandPortals
            // biome-ignore lint/suspicious/noArrayIndexKey: the blocks are those of this html, in order
            key={i}
            segments={segments}
            bar={bar}
            panel={panel}
            open={mine}
            focusKey={mine ? picked?.key : undefined}
            onOpenChange={(open) => setPicked(open ? { block } : null)}
          />
        )
      })}
    </>
  )
}
