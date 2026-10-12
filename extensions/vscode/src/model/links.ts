// What a diagram folder cannot know alone: the diagrams its nodes open. The folders of one
// `diagrams/` directory are one project, as they are to `loadProject`, so each group is linked on
// its own. Pure: outcomes in, diagnostics and diagrams out.
import { dirname } from 'node:path'
import {
  type CompiledDiagram,
  type LinkEntry,
  linkDiagrams,
  nestedDiagrams,
} from '@the-package-labs/idocs-core'
import type { Diagnostic } from '@the-package-labs/idocs-core/browser'
import type { CompileOutcome } from './compile'
import { isInside } from './paths'

/** The folders that share a project with `folder`, itself included. */
export const sameProject = <T extends { folder: string }>(folder: string, all: Iterable<T>): T[] =>
  [...all].filter((o) => dirname(o.folder) === dirname(folder))

/**
 * Cross-diagram problems, filed under the folder whose file they are in. `file` is an absolute
 * path, as for every other diagnostic of the extension.
 */
export function linkProblems(outcomes: CompileOutcome[]): Map<string, Diagnostic[]> {
  const byFolder = new Map<string, Diagnostic[]>()
  const projects = new Map<string, CompileOutcome[]>()
  for (const o of outcomes) {
    const key = dirname(o.folder)
    projects.set(key, [...(projects.get(key) ?? []), o])
  }
  for (const group of projects.values()) {
    const entries: Record<string, LinkEntry> = {}
    for (const o of group) entries[o.name] = { diagram: o.diagram, where: o.where }
    for (const d of linkDiagrams(entries)) {
      const owner = group.find((o) => isInside(o.folder, d.file))
      if (owner) byFolder.set(owner.folder, [...(byFolder.get(owner.folder) ?? []), d])
    }
  }
  return byFolder
}

export interface Known {
  folder: string
  name: string
  /** The newest version that compiled, which may be older than the text. */
  diagram?: CompiledDiagram
}

/** Every diagram that `folder`'s diagram can open, from the newest version of each that compiled. */
export function nestedFor(folder: string, known: Known[]): Record<string, CompiledDiagram> {
  const project = sameProject(folder, known)
  const all: Record<string, CompiledDiagram> = {}
  for (const k of project) if (k.diagram) all[k.name] = k.diagram
  const self = project.find((k) => k.folder === folder)
  return self ? nestedDiagrams(all, self.name) : {}
}
