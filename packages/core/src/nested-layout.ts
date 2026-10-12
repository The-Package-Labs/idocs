// Laying out a diagram whose nodes are expanded in place. An expanded node is a group that holds
// another whole diagram; layout stays "group by group, bottom up": the inner diagram is laid out
// first and reported as the node's size, so the outer diagram sees one larger node and every edge
// still ends on its border. Pure: no DOM, so tests can run it.
import { layoutView, type NodeSize } from './layout'
import type { CompiledDiagram, CompiledNode, Layout, NodeDiagram, Pt, Rect } from './types'

/**
 * What an expanded node adds around the inner diagram: the header that names it, and a margin.
 * The inner layout already keeps a margin of its own, so the sides stay thin.
 */
export const INLINE_PAD = { top: 40, left: 4, right: 4, bottom: 4 }

/** A diagram laid out together with the diagrams expanded inside it, at any depth. */
export interface NestedLayout {
  layout: Layout
  /** By node id: the layout of the diagram that node shows in place. */
  inner: Record<string, InnerLayout>
}

export interface InnerLayout {
  /** Name of the diagram shown. */
  name: string
  viewId: string
  /** Where the inner diagram's origin sits inside the expanded node's rectangle. */
  offset: Pt
  layout: NestedLayout
}

export type Diagrams = Record<string, CompiledDiagram | undefined>

/** The view a node's diagram shows when opened: the one named, the scenario's, or the first. */
export function openingView(diagram: CompiledDiagram, ref: NodeDiagram): string {
  const has = (id: string | undefined) => diagram.views.some((v) => v.id === id)
  if (has(ref.view)) return ref.view!
  const fromScenario = diagram.scenarios.find((s) => s.id === ref.scenario)?.view
  return has(fromScenario) ? fromScenario! : diagram.views[0]!.id
}

/** Whether a reader may show this node's diagram in place: it is at hand and not limited to `open`. */
export const canExpand = (ref: NodeDiagram | undefined, diagrams: Diagrams): boolean =>
  !!ref && ref.mode !== 'open' && !!diagrams[ref.name]

/** Whether a reader may move into this node's diagram: it is at hand and not limited to `expand`. */
export const canOpen = (ref: NodeDiagram | undefined, diagrams: Diagrams): boolean =>
  !!ref && ref.mode !== 'expand' && !!diagrams[ref.name]

/** Paths are node ids joined with `/` (ids cannot contain it): `orders`, `orders/stock`. */
export const pathJoin = (prefix: string, id: string) => `${prefix}${id}`

/**
 * The paths the author asked to start expanded (`expanded: true`), at every depth. A node counts
 * wherever it sits in its diagram, in whichever view, so switching views loses nothing.
 */
export function defaultExpanded(
  diagram: CompiledDiagram,
  diagrams: Diagrams,
  prefix = '',
  seen: readonly string[] = [],
): string[] {
  const out: string[] = []
  for (const node of Object.values(diagram.nodes)) {
    const ref = node.diagram
    const child = ref && diagrams[ref.name]
    if (!ref || !child || seen.includes(ref.name) || !ref.expanded || !canExpand(ref, diagrams))
      continue
    const path = pathJoin(prefix, node.id)
    out.push(path, ...defaultExpanded(child, diagrams, `${path}/`, [...seen, diagram.name]))
  }
  return out
}

/**
 * Every node whose card has to be measured to lay `viewId` out with these paths expanded: the
 * view's own, and those of each diagram shown in place. `key` is the path, which is what the
 * layout reads sizes by.
 */
export function measurable(
  diagram: CompiledDiagram,
  viewId: string,
  expanded: ReadonlySet<string>,
  diagrams: Diagrams,
  prefix = '',
): { key: string; node: CompiledNode }[] {
  const view = diagram.views.find((v) => v.id === viewId)
  if (!view) return []
  const out: { key: string; node: CompiledNode }[] = []
  for (const id of view.nodeIds) {
    const node = diagram.nodes[id]!
    const path = pathJoin(prefix, id)
    out.push({ key: path, node })
    const ref = node.diagram
    const child =
      ref && expanded.has(path) && canExpand(ref, diagrams) ? diagrams[ref.name] : undefined
    if (ref && child) {
      out.push(...measurable(child, openingView(child, ref), expanded, diagrams, `${path}/`))
    }
  }
  return out
}

export interface NestedOptions {
  /** Measured card sizes by path. A plain node id for the diagram itself, `orders/api` inside. */
  sizes?: Record<string, Partial<NodeSize>>
  /** Paths shown in place. */
  expanded?: ReadonlySet<string>
  /** Where the diagrams a node opens are found, by name. */
  diagrams?: Diagrams
  prefix?: string
}

/** Lay out `viewId` with the nodes in `expanded` shown in place, each as a group around its diagram. */
export async function layoutNested(
  diagram: CompiledDiagram,
  viewId: string,
  { sizes = {}, expanded, diagrams = {}, prefix = '' }: NestedOptions = {},
): Promise<NestedLayout> {
  const view = diagram.views.find((v) => v.id === viewId)
  if (!view) throw new Error(`Unknown view "${viewId}"`)

  const own: Record<string, Partial<NodeSize>> = {}
  for (const id of view.nodeIds) {
    const size = sizes[pathJoin(prefix, id)]
    if (size) own[id] = size
  }

  const inner: Record<string, InnerLayout> = {}
  await Promise.all(
    view.nodeIds.map(async (id) => {
      const ref = diagram.nodes[id]!.diagram
      const path = pathJoin(prefix, id)
      const child =
        ref && expanded?.has(path) && canExpand(ref, diagrams) ? diagrams[ref.name] : undefined
      if (!ref || !child) return
      const childView = openingView(child, ref)
      const layout = await layoutNested(child, childView, {
        sizes,
        expanded,
        diagrams,
        prefix: `${path}/`,
      })
      inner[id] = {
        name: ref.name,
        viewId: childView,
        offset: { x: INLINE_PAD.left, y: INLINE_PAD.top },
        layout,
      }
      own[id] = {
        w: layout.layout.width + INLINE_PAD.left + INLINE_PAD.right,
        h: layout.layout.height + INLINE_PAD.top + INLINE_PAD.bottom,
      }
    }),
  )

  return { layout: await layoutView(diagram, viewId, own), inner }
}

/**
 * Where a node sits in the world of the diagram laid out first, however deep it is: the rectangle
 * of `orders/stock` is `stock`'s inside `orders`, moved to where `orders` is. Undefined when a
 * step of the path is not laid out (it is not expanded, or not in the view).
 */
export function rectOfPath(nested: NestedLayout, path: string): Rect | undefined {
  let level: NestedLayout | undefined = nested
  let at: Pt = { x: 0, y: 0 }
  const ids = path.split('/')
  for (const [i, id] of ids.entries()) {
    const r: Rect | undefined = level?.layout.nodes[id]
    if (!level || !r) return undefined
    if (i === ids.length - 1) return { x: at.x + r.x, y: at.y + r.y, w: r.w, h: r.h }
    const inner: InnerLayout | undefined = level.inner[id]
    if (!inner) return undefined
    at = { x: at.x + r.x + inner.offset.x, y: at.y + r.y + inner.offset.y }
    level = inner.layout
  }
  return undefined
}
