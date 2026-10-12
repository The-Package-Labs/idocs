// Diagrams that open other diagrams (`diagram:` on a node). Pure data in, pure data out, so the
// loader, the editor and the Astro component share it and the browser entry can carry it.
import type { Diagnostic, Where } from './compiler'
import { didYouMean } from './suggest'
import type { CompiledDiagram } from './types'

/** What the linker needs to know about one diagram folder. `diagram` is missing when it failed to compile. */
export interface LinkEntry {
  diagram?: CompiledDiagram
  where?: Where
}

/**
 * Every diagram that `name` can reach by opening nodes, directly or through other diagrams, but
 * not `name` itself. This is what a page has to ship so the reader can look inside without
 * another request.
 */
export function nestedDiagrams(
  all: Record<string, CompiledDiagram>,
  name: string,
): Record<string, CompiledDiagram> {
  const out: Record<string, CompiledDiagram> = {}
  const queue = [name]
  for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
    for (const node of Object.values(all[cur]?.nodes ?? {})) {
      const next = node.diagram?.name
      if (next === undefined || next === name || out[next] || !all[next]) continue
      out[next] = all[next]
      queue.push(next)
    }
  }
  return out
}

/**
 * Check what no single diagram can: that a node opens a diagram which exists, that the view and
 * scenario it asks for exist there, and that diagrams do not open each other in a circle (a node
 * cannot contain itself).
 */
export function linkDiagrams(entries: Record<string, LinkEntry>): Diagnostic[] {
  const out: Diagnostic[] = []
  const names = Object.keys(entries).sort()
  const known = names.filter((n) => entries[n]!.diagram)

  const report = (from: string, path: (string | number)[], message: string, hint?: string) => {
    const at = entries[from]!.where?.(path)
    out.push({
      severity: 'error',
      message,
      file: at?.file ?? `diagrams/${from}/diagram.yaml`,
      line: at?.line,
      col: at?.col,
      path: path.join('.'),
      hint,
    })
  }

  const edges = new Map<string, Set<string>>()
  for (const from of names) {
    const diagram = entries[from]!.diagram
    if (!diagram) continue
    for (const node of Object.values(diagram.nodes)) {
      const ref = node.diagram
      if (!ref) continue
      const at = ['nodes', node.id, 'diagram']
      // Falls back to the `diagram` key itself when it was written as a plain name.
      const sub = (key: 'view' | 'scenario') => [...at, key]
      const target = entries[ref.name]
      if (!target) {
        report(
          from,
          at,
          `Node "${node.id}" opens diagram "${ref.name}", which does not exist`,
          didYouMean(ref.name, names) ??
            (names.length > 1
              ? `Diagrams: ${names.filter((n) => n !== from).join(', ')}`
              : undefined),
        )
        continue
      }
      if (!target.diagram) continue // its own errors are reported already
      edges.set(from, (edges.get(from) ?? new Set<string>()).add(ref.name))

      const views = target.diagram.views.map((v) => v.id)
      const scenario = ref.scenario
        ? target.diagram.scenarios.find((s) => s.id === ref.scenario)
        : undefined
      if (ref.view && !views.includes(ref.view)) {
        report(
          from,
          sub('view'),
          `Diagram "${ref.name}" has no view "${ref.view}"`,
          didYouMean(ref.view, views) ?? `Views: ${views.join(', ')}`,
        )
      }
      if (ref.scenario && !scenario) {
        const ids = target.diagram.scenarios.map((s) => s.id)
        report(
          from,
          sub('scenario'),
          `Diagram "${ref.name}" has no scenario "${ref.scenario}"`,
          didYouMean(ref.scenario, ids) ??
            (ids.length ? `Scenarios: ${ids.join(', ')}` : 'It has no scenarios.'),
        )
      } else if (scenario && ref.view && scenario.view !== ref.view) {
        report(
          from,
          sub('scenario'),
          `Scenario "${scenario.id}" plays on view "${scenario.view}", not "${ref.view}"`,
          "Drop `view`, and the diagram opens on the scenario's own view.",
        )
      }
    }
  }

  // Depth-first from every diagram; an edge back to one still on the stack closes a circle.
  const state = new Map<string, 'open' | 'done'>()
  const stack: string[] = []
  const visit = (name: string) => {
    state.set(name, 'open')
    stack.push(name)
    for (const next of edges.get(name) ?? new Set<string>()) {
      if (state.get(next) === 'open') {
        const circle = [...stack.slice(stack.indexOf(next)), next]
        const node = Object.values(entries[name]!.diagram!.nodes).find(
          (n) => n.diagram?.name === next,
        )!
        report(
          name,
          ['nodes', node.id, 'diagram'],
          next === name
            ? `Node "${node.id}" opens its own diagram "${name}"`
            : `Node "${node.id}" opens "${next}", which leads back to "${name}"`,
          `A diagram cannot be inside itself: ${circle.join(' → ')}`,
        )
      } else if (!state.has(next)) visit(next)
    }
    stack.pop()
    state.set(name, 'done')
  }
  for (const name of known) if (!state.has(name)) visit(name)

  return out
}
