import { type CompiledNode, canExpand, canOpen, type Diagrams } from '@the-package-labs/idocs-core'
import type { NodeInside } from './NodeCard'

/**
 * What a reader may do with the diagram a node holds, or undefined when it holds none they can
 * reach. `open` is false where the page cannot move into a diagram (`canOpen` false).
 */
export function insideOf(
  node: CompiledNode,
  diagrams: Diagrams | undefined,
  mayOpen: boolean,
): NodeInside | undefined {
  const ref = node.diagram
  const target = ref && diagrams?.[ref.name]
  if (!ref || !target || !diagrams) return undefined
  const expand = canExpand(ref, diagrams)
  const open = mayOpen && canOpen(ref, diagrams)
  if (!expand && !open) return undefined
  return {
    title: target.title,
    nodes: Object.keys(target.nodes).length,
    scenarios: target.scenarios.length,
    expand,
    open,
  }
}
