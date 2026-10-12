// The hierarchy of a view as a tree, for an outline beside the picture: groups hold groups and
// nodes, a node lists its connections, and a node shown in place holds the nodes of the diagram
// it shows. Pure data in, pure data out, so the outline is a thin view over it and tests can run it.
import { canExpand, canOpen, type Diagrams, openingView, pathJoin } from './nested-layout'
import type { CompiledDiagram, CompiledView, IconData, Status } from './types'

/** One edge of a node, seen from that node. */
export interface OutlineConnection {
  edge: string
  /** `out`: this node sends to `other`; `in`: it receives from `other`; `both`: edge goes either way. */
  dir: 'out' | 'in' | 'both'
  /** Id of the node at the other end, in the same diagram. */
  other: string
  /** Its title, so a row needs nothing else to be read. */
  otherTitle: string
  label?: string
  kind: string
  status: Status
}

export interface OutlineNode {
  type: 'node'
  /** The node id, or ids joined with `/` for a node inside one shown in place (`orders/stock`). */
  path: string
  id: string
  title: string
  sub?: string
  icon?: IconData
  status: Status
  connections: OutlineConnection[]
  /** Present when the node holds a diagram the reader can reach. */
  inside?: {
    title: string
    /** The reader may show it in place, and may move into it. */
    expand: boolean
    open: boolean
    /** Shown in place right now; `items` are then the nodes of that diagram. */
    expanded: boolean
    items: OutlineItem[]
  }
}

export interface OutlineGroup {
  type: 'group'
  /** Group id, prefixed like a node path so it is unique across the levels shown in place. */
  path: string
  id: string
  title: string
  caption?: string
  icon?: IconData
  status: Status
  items: OutlineItem[]
  /** How many nodes it holds, however deep. */
  count: number
}

export type OutlineItem = OutlineNode | OutlineGroup

export interface OutlineOptions {
  /** Where the diagrams a node holds are found, by name. */
  diagrams?: Diagrams
  /** Paths shown in place. */
  expanded?: ReadonlySet<string>
  prefix?: string
  /** Diagrams already on the way down, so a loop cannot run forever. */
  seen?: readonly string[]
}

/** The nodes and groups of `view` as a tree, in the order the author wrote them. */
export function buildOutline(
  diagram: CompiledDiagram,
  view: CompiledView,
  { diagrams = {}, expanded = new Set(), prefix = '', seen = [] }: OutlineOptions = {},
): OutlineItem[] {
  const inView = new Set(view.nodeIds)
  const groups = new Set(view.groupIds)
  const drawn = view.edgeIds.map((id) => diagram.edges[id]!).filter((e) => !e.hidden)

  const connectionsOf = (id: string): OutlineConnection[] => {
    const out: OutlineConnection[] = []
    for (const e of drawn) {
      const sends = e.from === id
      const gets = e.to === id
      if (!sends && !gets) continue
      const other = sends ? e.to : e.from
      out.push({
        edge: e.id,
        dir: e.both ? 'both' : sends ? 'out' : 'in',
        other,
        otherTitle: diagram.nodes[other]?.title ?? other,
        label: e.label,
        kind: e.kind,
        status: e.status,
      })
    }
    // What a node sends first, then what it receives, each in the order the edges were written.
    const rank = { out: 0, both: 1, in: 2 }
    return out.sort((a, b) => rank[a.dir] - rank[b.dir])
  }

  const nodeItem = (id: string): OutlineNode => {
    const node = diagram.nodes[id]!
    const path = pathJoin(prefix, id)
    const item: OutlineNode = {
      type: 'node',
      path,
      id,
      title: node.title,
      sub: node.sub,
      icon: node.icon,
      status: node.status,
      connections: connectionsOf(id),
    }
    const ref = node.diagram
    const child = ref && diagrams[ref.name]
    if (
      ref &&
      child &&
      !seen.includes(ref.name) &&
      (canExpand(ref, diagrams) || canOpen(ref, diagrams))
    ) {
      const shown = canExpand(ref, diagrams) && expanded.has(path)
      const childView = child.views.find((v) => v.id === openingView(child, ref))
      item.inside = {
        title: child.title,
        expand: canExpand(ref, diagrams),
        open: canOpen(ref, diagrams),
        expanded: shown,
        items:
          shown && childView
            ? buildOutline(child, childView, {
                diagrams,
                expanded,
                prefix: `${path}/`,
                seen: [...seen, diagram.name],
              })
            : [],
      }
    }
    return item
  }

  // Children of each group (or of the top, under ''). A group the view does not draw, or a node
  // whose group it does not draw, sits at the top. Groups and nodes keep the order the author
  // wrote them in: a group stands where its first node does.
  const childGroups = new Map<string, string[]>()
  for (const gid of view.groupIds) {
    const parent = diagram.groups[gid]?.parent
    const key = parent && groups.has(parent) ? parent : ''
    childGroups.set(key, [...(childGroups.get(key) ?? []), gid])
  }
  const childNodes = new Map<string, string[]>()
  for (const id of view.nodeIds) {
    if (!inView.has(id)) continue
    const group = diagram.nodes[id]!.group
    const key = group && groups.has(group) ? group : ''
    childNodes.set(key, [...(childNodes.get(key) ?? []), id])
  }
  const position = new Map(view.nodeIds.map((id, i) => [id, i]))
  const firstNode = (gid: string): number =>
    Math.min(
      ...(childNodes.get(gid) ?? []).map((n) => position.get(n)!),
      ...(childGroups.get(gid) ?? []).map(firstNode),
    )

  const groupItem = (gid: string): OutlineGroup => {
    const g = diagram.groups[gid]!
    const items = fill(gid)
    return {
      type: 'group',
      path: pathJoin(prefix, `#${gid}`),
      id: gid,
      title: g.label,
      caption: g.caption,
      icon: g.icon,
      status: g.status,
      items,
      count: items.reduce((n, i) => n + (i.type === 'group' ? i.count : 1), 0),
    }
  }
  function fill(key: string): OutlineItem[] {
    const ranked = [
      ...(childGroups.get(key) ?? []).map((gid) => ({
        at: firstNode(gid),
        make: () => groupItem(gid),
      })),
      ...(childNodes.get(key) ?? []).map((id) => ({
        at: position.get(id)!,
        make: () => nodeItem(id),
      })),
    ]
    return ranked.sort((a, b) => a.at - b.at).map((r) => r.make())
  }
  return fill('')
}

/** Every node of an outline, in reading order, at any depth. */
export function outlineNodes(items: readonly OutlineItem[]): OutlineNode[] {
  const out: OutlineNode[] = []
  for (const item of items) {
    if (item.type === 'group') out.push(...outlineNodes(item.items))
    else out.push(item, ...outlineNodes(item.inside?.items ?? []))
  }
  return out
}
