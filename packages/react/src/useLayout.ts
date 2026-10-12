import {
  type CompiledDiagram,
  type Diagrams,
  type Layout,
  layoutNested,
  type NestedLayout,
} from '@the-package-labs/idocs-core'
import { useEffect, useRef, useState } from 'react'

/**
 * Two passes: render every node card offscreen to learn its height at its fixed width,
 * then hand the sizes to ELK. Re-runs when web fonts finish loading, since text wraps differently.
 * The cards of every diagram shown in place are measured too, by path.
 *
 * `enabled` is false while the diagram is covered by one opened from it. A container that is not
 * displayed measures every card as 0 px, so the old layout is kept until it is shown again.
 */
export function useLayout(
  diagram: CompiledDiagram,
  viewId: string,
  enabled = true,
  expanded: ReadonlySet<string> = EMPTY,
  diagrams: Diagrams = NONE,
) {
  const measureRef = useRef<HTMLDivElement>(null)
  const [nested, setNested] = useState<NestedLayout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fontTick, setFontTick] = useState(0)
  // Counts finished layouts, so a caller can tell whether the one it sees is newer than something.
  const [generation, setGeneration] = useState(0)
  const expandedKey = [...expanded].sort().join(',')
  const laidOut = useRef<{
    diagram: CompiledDiagram
    viewId: string
    fontTick: number
    expandedKey: string
  } | null>(null)

  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts) return
    const bump = () => setFontTick((n) => n + 1)
    fonts.addEventListener('loadingdone', bump)
    return () => fonts.removeEventListener('loadingdone', bump)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const last = laidOut.current
    if (
      last?.diagram === diagram &&
      last.viewId === viewId &&
      last.fontTick === fontTick &&
      last.expandedKey === expandedKey
    )
      return
    let cancelled = false
    const run = async () => {
      await document.fonts?.ready
      const host = measureRef.current
      if (!host || cancelled) return
      const sizes: Record<string, { w: number; h: number }> = {}
      host.querySelectorAll<HTMLElement>('[data-measure]').forEach((el) => {
        sizes[el.dataset.measure!] = { w: el.offsetWidth, h: el.offsetHeight }
      })
      try {
        const next = await layoutNested(diagram, viewId, { sizes, expanded, diagrams })
        if (!cancelled) {
          laidOut.current = { diagram, viewId, fontTick, expandedKey }
          setError(null)
          setNested(next)
          setGeneration((n) => n + 1)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [diagram, viewId, fontTick, enabled, expandedKey, expanded, diagrams])

  const layout: Layout | null = nested?.layout ?? null
  return { layout, nested, generation, error, measureRef }
}

const EMPTY: ReadonlySet<string> = new Set()
const NONE: Diagrams = {}
