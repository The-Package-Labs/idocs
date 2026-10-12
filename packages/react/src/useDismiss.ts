import { type RefObject, useEffect } from 'react'

/**
 * Close a popover on a press outside it. `inside` are the elements that count as part of it (the
 * popover and the button that opens it). Escape is left to the owner, which knows where focus goes.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  ...inside: RefObject<HTMLElement | null>[]
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are stable objects
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const at = e.target as Node
      if (!inside.some((r) => r.current?.contains(at))) close()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, close])
}
