// Node-only entry: parsing, validation, compilation and loading a project from disk.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { compileDiagram, type Diagnostic } from './compile'
import { type LinkEntry, linkDiagrams } from './nesting'
import type { CompiledDiagram } from './types'

export * from './compile'
export { loadIconSets, resolveIcon, searchIcons } from './icons'
export { renderMarkdown } from './markdown'
export { type LinkEntry, linkDiagrams, nestedDiagrams } from './nesting'
export { authoringJsonSchema, FamilySchema, KNOWN_KEYS, RootSchema } from './schema'

export interface LoadedProject {
  diagrams: Record<string, CompiledDiagram>
  diagnostics: Diagnostic[]
  /** Files and directories whose changes should trigger a reload. */
  watch: string[]
}

const DIAGRAM_FILES = ['diagram.yaml', 'diagram.yml']

export function diagramsDir(root: string, dir = 'diagrams'): string {
  return resolve(root, dir)
}

/** Load every `<root>/diagrams/<name>/diagram.yaml`, compiling each one. */
export function loadProject(root: string, dir = 'diagrams'): LoadedProject {
  const base = diagramsDir(root, dir)
  const result: LoadedProject = { diagrams: {}, diagnostics: [], watch: [base] }
  if (!existsSync(base)) return result
  const entries: Record<string, LinkEntry> = {}

  for (const name of readdirSync(base).sort()) {
    const folder = join(base, name)
    if (!statSync(folder).isDirectory()) continue
    const file = DIAGRAM_FILES.map((f) => join(folder, f)).find(existsSync)
    if (!file) continue

    const scenarioDir = join(folder, 'scenarios')
    const scenarioFiles = existsSync(scenarioDir)
      ? readdirSync(scenarioDir)
          .filter((f) => /\.ya?ml$/.test(f))
          .sort()
          .map((f) => ({
            id: f.replace(/\.ya?ml$/, ''),
            file: join(scenarioDir, f),
            text: readFileSync(join(scenarioDir, f), 'utf8'),
          }))
      : []

    const { diagram, diagnostics, where } = compileDiagram({
      name,
      file: relative(root, file),
      text: readFileSync(file, 'utf8'),
      scenarioFiles: scenarioFiles.map((s) => ({ ...s, file: relative(root, s.file) })),
      readFile: (rel) => readInside(folder, rel),
    })
    result.diagnostics.push(...diagnostics)
    if (diagram) result.diagrams[name] = diagram
    entries[name] = { diagram, where }
    result.watch.push(folder)
  }
  result.diagnostics.push(...linkDiagrams(entries))
  return result
}

/** Read a file below `folder`; paths that escape it are treated as missing. */
function readInside(folder: string, rel: string): string | undefined {
  const full = resolve(folder, rel)
  if (full !== folder && !full.startsWith(folder + sep)) return undefined
  try {
    return readFileSync(full, 'utf8')
  } catch {
    return undefined
  }
}

export function formatDiagnostic(d: Diagnostic): string {
  const loc = d.line ? `:${d.line}:${d.col ?? 1}` : ''
  const hint = d.hint ? `\n    ${d.hint}` : ''
  return `${d.file}${loc}  ${d.severity}  ${d.message}${hint}`
}
