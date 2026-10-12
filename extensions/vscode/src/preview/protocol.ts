// The messages between the extension and the preview webview. Both sides import these types;
// everything in a message must survive structured cloning (plain JSON).
import type { CompiledDiagram } from '@the-package-labs/idocs-core'

export interface Problem {
  severity: 'error' | 'warning'
  message: string
  hint?: string
  /** Absolute path of the file the problem is in. */
  file: string
  /** The file as the reader knows it: `diagram.yaml`, `scenarios/checkout.yaml`. */
  label: string
  line?: number
  col?: number
}

export type ToWebview =
  | {
      type: 'diagram'
      name: string
      folder: string
      /** The last diagram that compiled; null while there never was one. */
      diagram: CompiledDiagram | null
      /** The diagrams its nodes open, by name, as far as they have compiled. */
      nested: Record<string, CompiledDiagram>
      /** True when `diagram` is older than the text, because the text has errors. */
      stale: boolean
      problems: Problem[]
      locked: boolean
    }
  /** The node the editor cursor is in, to outline in the diagram. */
  | { type: 'select'; node: string | null }
  | { type: 'lock'; locked: boolean }
  | { type: 'empty'; message: string }

export type FromWebview =
  | { type: 'ready' }
  | { type: 'reveal-node'; id: string }
  | { type: 'reveal-problem'; file: string; line?: number; col?: number }
  | { type: 'toggle-lock' }
  | { type: 'refresh' }
