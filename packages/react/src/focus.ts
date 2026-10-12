import type { CompiledDiagram, CompiledView } from '@the-package-labs/idocs-core'

export interface Hover {
  node?: string
  edge?: string
}

/**
 * Which nodes and edges the pointer, or else the node that stays selected, is pointing at. Null
 * when nothing is, so nothing is faded.
 */
export function focusOf(
  diagram: CompiledDiagram,
  view: CompiledView,
  hover: Hover,
  staying?: string | null,
): { nodes: Set<string>; edges: Set<string> } | null {
  const nodeId = hover.node ?? (hover.edge ? undefined : (staying ?? undefined))
  if (!nodeId && !hover.edge) return null
  const nodes = new Set<string>()
  const edges = new Set<string>()
  if (hover.edge) {
    const e = diagram.edges[hover.edge]
    if (e) {
      edges.add(e.id)
      nodes.add(e.from)
      nodes.add(e.to)
    }
  } else if (nodeId) {
    nodes.add(nodeId)
    for (const id of view.edgeIds) {
      const e = diagram.edges[id]!
      if (e.from === nodeId || e.to === nodeId) {
        edges.add(id)
        nodes.add(e.from)
        nodes.add(e.to)
      }
    }
  }
  return { nodes, edges }
}
