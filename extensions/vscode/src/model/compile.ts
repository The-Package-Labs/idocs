// Compiles one diagram folder with the same compiler `idocs check` uses, then adds the checks the
// CLI does on top of it (a node citing a source file that no longer exists).
import { dirname, resolve } from 'node:path'
import type { CompiledDiagram } from '@the-package-labs/idocs-core'
import {
  type CompileResult,
  compileDiagram,
  type Diagnostic,
  type Where,
} from '@the-package-labs/idocs-core/browser'
import type { IconResolver } from './icons'
import { type Fs, gatherSource } from './sources'
import { nodeAt, Parsed } from './yaml'

export interface CompileOutcome {
  /** Absolute path of the diagram folder. */
  folder: string
  name: string
  /** The `diagram.yaml` that was compiled. */
  file: string
  /** Undefined when the diagram has errors. */
  diagram?: CompiledDiagram
  /** Errors and warnings. `file` is an absolute path. */
  diagnostics: Diagnostic[]
  /** Where a path of the diagram is in its files, for the checks that span diagrams (`links.ts`). */
  where?: Where
}

export interface CompileOptions {
  fs: Fs
  icons: Pick<IconResolver, 'resolveIcon'>
  /** Folders a `refs:` path is looked up in: the project root and the workspace folders. */
  refBases: string[]
}

export function compileFolder(folder: string, options: CompileOptions): CompileOutcome | undefined {
  const source = gatherSource(folder, options.fs)
  if (!source) return undefined

  const result: CompileResult = compileDiagram(source, { resolveIcon: options.icons.resolveIcon })
  const diagnostics = [...result.diagnostics]
  if (result.diagram) {
    diagnostics.push(...staleRefs(result.diagram, source.file, source.text, options))
  }
  return {
    folder,
    name: source.name,
    file: source.file,
    diagram: result.diagram,
    diagnostics,
    where: result.where,
  }
}

/** `src/api.ts`, `src/api.ts:40`, `src/api.ts#L40`. URLs and bare words are left alone. */
export function refPath(ref: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) return undefined
  const path = ref.replace(/(#L?\d+(-L?\d+)?|:\d+(-\d+)?)$/, '')
  return /[/.]/.test(path) ? path : undefined
}

/** Warn when a node cites a source file that no longer exists: a sign the diagram has gone stale. */
export function staleRefs(
  diagram: CompiledDiagram,
  file: string,
  text: string,
  { fs, refBases }: Pick<CompileOptions, 'fs' | 'refBases'>,
): Diagnostic[] {
  const out: Diagnostic[] = []
  let parsed: Parsed | undefined
  for (const node of Object.values(diagram.nodes)) {
    node.refs.forEach((ref, index) => {
      const path = refPath(ref)
      if (!path || refBases.some((base) => fs.exists(resolve(base, path)))) return
      parsed ??= new Parsed(text)
      const at = parsed.span(nodeAt(parsed.root, ['nodes', node.id, 'refs', index]) as never)
      out.push({
        severity: 'warning',
        message: `Node "${node.id}" cites "${ref}", which does not exist`,
        file,
        line: at ? at.start.line + 1 : undefined,
        col: at ? at.start.character + 1 : undefined,
        hint: 'The code may have moved. Update the diagram or the reference.',
      })
    })
  }
  return out
}

/** Folders to look in for `refs:`: the project root (above `diagrams/`) and the workspace folders. */
export function refBasesFor(folder: string, workspaceFolders: string[]): string[] {
  return [resolve(dirname(folder), '..'), ...workspaceFolders]
}
