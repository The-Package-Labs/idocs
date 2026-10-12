import { type CompiledDiagram, type Layout, layoutView } from '@the-package-labs/idocs-core'
import { useEffect, useRef, useState } from 'react'

/**
 * Two passes: render every node card offscreen to learn its height at its fixed width,
 * then hand the sizes to ELK. Re-runs when web fonts finish loading, since text wraps differently.
 *
 * `enabled` is false while the diagram is covered by one opened from it. A container that is not
 * displayed measures every card as 0 px, so the old layout is kept until it is shown again.
 */
export function useLayout(diagram: CompiledDiagram, viewId: string, enabled = true) {
  const measureRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fontTick, setFontTick] = useState(0)
  const laidOut = useRef<{ diagram: CompiledDiagram; viewId: string; fontTick: number } | null>(
    null,
  )

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
    if (last?.diagram === diagram && last.viewId === viewId && last.fontTick === fontTick) return
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
        const next = await layoutView(diagram, viewId, sizes)
        if (!cancelled) {
          laidOut.current = { diagram, viewId, fontTick }
          setError(null)
          setLayout(next)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [diagram, viewId, fontTick, enabled])

  return { layout, error, measureRef }
}
