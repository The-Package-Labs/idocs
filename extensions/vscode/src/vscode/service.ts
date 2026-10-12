// The one place that knows what the workspace's diagrams look like right now. It compiles a
// diagram folder from the editor's buffers (so unsaved edits count), remembers the last version
// that compiled, publishes diagnostics, and tells the preview when something changed.
import { basename, join } from 'node:path'
import type { CompiledDiagram } from '@the-package-labs/idocs-core'
import type { Diagnostic } from '@the-package-labs/idocs-core/browser'
import * as vscode from 'vscode'
import type { Entity, ProjectIds } from '../language/completion'
import { diagnosticSpan } from '../language/diagnostics'
import { type CompileOutcome, compileFolder, refBasesFor } from '../model/compile'
import { type Declaration, declarationsOf } from '../model/declarations'
import type { IconResolver } from '../model/icons'
import { linkProblems, nestedFor, sameProject } from '../model/links'
import { DIAGRAM_FILES, type FileRole, isInside, type Located, locate } from '../model/paths'
import { type Reference, referencesIn } from '../model/references'
import { type Fs, nodeFs } from '../model/sources'
import { Parsed } from '../model/yaml'
import { settings } from './settings'

export interface FileModel {
  path: string
  role: 'diagram' | 'scenario'
  scenarioId?: string
  parsed: Parsed
  declarations: Declaration[]
  refs: Reference[]
}

export interface FolderState {
  folder: string
  name: string
  outcome: CompileOutcome
  /** The newest diagram that compiled, which may be older than the text. */
  lastGood?: CompiledDiagram
  /** What triggered this compile: typing, or a save, an open, a close or a change on disk. */
  cause: 'edit' | 'save'
  /** Problems with the diagrams this one opens: they depend on other folders, so they are kept apart. */
  links: Diagnostic[]
}

/** Everything wrong with a diagram, in its own files and across diagrams. */
export const diagnosticsOf = (state: FolderState): Diagnostic[] => [
  ...state.outcome.diagnostics,
  ...state.links,
]

const sameDiagnostics = (a: Diagnostic[], b: Diagnostic[]) =>
  JSON.stringify(a) === JSON.stringify(b)

export class DiagramService implements vscode.Disposable {
  private readonly states = new Map<string, FolderState>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly causes = new Map<string, FolderState['cause']>()
  private readonly reported = new Map<string, Set<string>>()
  private readonly parsed = new Map<string, FileModel & { text: string }>()
  private readonly disposables: vscode.Disposable[] = []
  /** While a batch compiles, neighbours are not all known yet, so linking waits for its end. */
  private deferLinks = false
  private readonly emitter = new vscode.EventEmitter<FolderState>()
  private readonly removed = new vscode.EventEmitter<string>()
  readonly diagnostics = vscode.languages.createDiagnosticCollection('idocs')

  readonly onDidCompile = this.emitter.event
  readonly onDidRemove = this.removed.event

  constructor(
    readonly icons: IconResolver,
    readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      this.emitter,
      this.removed,
      this.diagnostics,
      vscode.workspace.onDidChangeTextDocument((e) => this.touched(e.document.uri)),
      vscode.workspace.onDidOpenTextDocument((d) => this.touched(d.uri, true)),
      vscode.workspace.onDidCloseTextDocument((d) => this.touched(d.uri, true)),
      vscode.workspace.onDidSaveTextDocument((d) => this.touched(d.uri, true)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('idocs.diagnostics')) this.refreshAll()
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.discover()),
    )
    const watcher = vscode.workspace.createFileSystemWatcher('**/diagrams/**/*')
    const onFile = (uri: vscode.Uri) => this.touched(uri, true)
    this.disposables.push(
      watcher,
      watcher.onDidChange(onFile),
      watcher.onDidCreate(onFile),
      watcher.onDidDelete(onFile),
    )
  }

  // -- Files ------------------------------------------------------------------------------------

  /**
   * The file system as the editor sees it: open buffers win over what is on disk. Text is fetched
   * only for the files that are read, since this runs on every keystroke.
   */
  get fs(): Fs {
    const open = new Map<string, vscode.TextDocument>()
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === 'file') open.set(doc.uri.fsPath, doc)
    }
    return nodeFs({ text: (path) => open.get(path)?.getText(), has: (path) => open.has(path) })
  }

  /** Which diagram a file belongs to, and what it is in it. */
  locate(uri: vscode.Uri): Located | undefined {
    if (uri.scheme !== 'file') return undefined
    return locate(uri.fsPath, this.fs, join)
  }

  state(folder: string): FolderState | undefined {
    return this.states.get(folder)
  }

  get folders(): string[] {
    return [...this.states.keys()].sort()
  }

  // -- Compiling --------------------------------------------------------------------------------

  /** Find every diagram in the workspace and compile it. Returns the folders it compiled. */
  async discover(): Promise<string[]> {
    const glob = `**/diagrams/*/{${DIAGRAM_FILES.join(',')}}`
    const found = await vscode.workspace.findFiles(glob, '**/node_modules/**', 500)
    const compiled = new Set<string>()
    this.deferLinks = true
    try {
      for (const uri of found) {
        const where = this.locate(uri)
        if (where && !compiled.has(where.folder)) {
          compiled.add(where.folder)
          this.compile(where.folder)
        }
      }
    } finally {
      this.deferLinks = false
    }
    for (const folder of compiled) this.relink(folder, true)
    return [...compiled]
  }

  refreshAll(): void {
    for (const folder of this.states.keys()) this.schedule(folder, 0)
  }

  /** A file changed: recompile its diagram soon. */
  private touched(uri: vscode.Uri, immediate = false): void {
    if (uri.scheme !== 'file') return
    // Typing in a file that cannot be part of a diagram is the common case; skip it cheaply.
    if (!/\.(ya?ml|md|svg)$/i.test(uri.fsPath)) return
    const where = this.locate(uri)
    if (where) {
      const delay = immediate ? 0 : settings().updateDelay
      this.schedule(where.folder, delay, immediate ? 'save' : 'edit')
      return
    }
    // A deleted diagram.yaml no longer locates; find the folder that held it.
    for (const folder of this.states.keys()) {
      if (isInside(folder, uri.fsPath)) this.schedule(folder, 0, 'save')
    }
  }

  private schedule(folder: string, delay: number, cause: FolderState['cause'] = 'save'): void {
    // The latest trigger wins: a save that follows typing counts as a save.
    this.causes.set(folder, cause)
    clearTimeout(this.timers.get(folder))
    this.timers.set(
      folder,
      setTimeout(() => {
        this.timers.delete(folder)
        this.compile(folder)
      }, delay),
    )
  }

  /** Compile now. Safe to call often. */
  compile(folder: string): FolderState | undefined {
    try {
      const fs = this.fs
      const outcome = compileFolder(folder, {
        fs,
        icons: this.icons,
        refBases: refBasesFor(
          folder,
          (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
        ),
      })
      if (!outcome) {
        this.forget(folder)
        return undefined
      }
      const previous = this.states.get(folder)
      const state: FolderState = {
        folder,
        name: outcome.name,
        outcome,
        lastGood: outcome.diagram ?? previous?.lastGood,
        cause: this.causes.get(folder) ?? 'save',
        links: previous?.links ?? [],
      }
      this.states.set(folder, state)
      if (!this.deferLinks) this.relink(folder)
      this.publish(state, fs)
      this.emitter.fire(state)
      return state
    } catch (error) {
      // A bug in the compiler must not freeze the Problems panel and the preview on old results.
      this.log.error(`compiling ${folder} failed`, error as Error)
      return this.fail(folder, error)
    }
  }

  /** Report an unexpected failure as an error on the diagram, and keep the last good diagram. */
  private fail(folder: string, error: unknown): FolderState | undefined {
    const file = this.mainFile(folder)
    if (!file) return undefined
    const message = error instanceof Error ? error.message : String(error)
    const previous = this.states.get(folder)
    const state: FolderState = {
      folder,
      name: previous?.name ?? basename(folder),
      outcome: {
        folder,
        name: previous?.name ?? basename(folder),
        file,
        diagnostics: [
          { severity: 'error', message: `idocs could not check this diagram: ${message}`, file },
        ],
      },
      lastGood: previous?.lastGood,
      cause: this.causes.get(folder) ?? 'save',
      links: previous?.links ?? [],
    }
    this.states.set(folder, state)
    if (!this.deferLinks) this.relink(folder)
    this.publish(state, this.fs)
    this.emitter.fire(state)
    return state
  }

  private forget(folder: string): void {
    this.states.delete(folder)
    this.clearDiagnostics(folder)
    this.removed.fire(folder)
    // Diagrams that opened this one have a new problem to show.
    this.relink(folder)
  }

  /**
   * Check the diagrams of a project against each other. What one folder says about another changes
   * when either is edited, so the neighbours are refreshed too. `folder` itself is published by
   * the caller, unless `publishSelf` says nobody will.
   */
  private relink(folder: string, publishSelf = false): void {
    const project = sameProject(folder, this.states.values())
    const problems = linkProblems(project.map((s) => s.outcome))
    for (const state of project) {
      const links = problems.get(state.folder) ?? []
      if (sameDiagnostics(links, state.links)) continue
      state.links = links
      if (state.folder === folder && !publishSelf) continue
      this.publish(state, this.fs)
      this.emitter.fire(state)
    }
  }

  /** The diagrams a diagram can open, as far as they have compiled: what its preview carries. */
  nested(folder: string): Record<string, CompiledDiagram> {
    return nestedFor(
      folder,
      sameProject(folder, this.states.values()).map((s) => ({
        folder: s.folder,
        name: s.name,
        diagram: s.lastGood,
      })),
    )
  }

  // -- Diagnostics ------------------------------------------------------------------------------

  private publish(state: FolderState, fs: Fs): void {
    if (!settings().diagnostics) {
      this.clearDiagnostics(state.folder)
      return
    }

    const byFile = new Map<string, vscode.Diagnostic[]>()
    const text = new Map<string, string[]>()
    const linesOf = (file: string) => {
      let lines = text.get(file)
      if (!lines) {
        lines = (fs.readText(file) ?? '').split('\n')
        text.set(file, lines)
      }
      return lines
    }
    for (const d of diagnosticsOf(state)) {
      const span = diagnosticSpan(d, linesOf(d.file))
      const range = new vscode.Range(
        span.start.line,
        span.start.character,
        span.end.line,
        span.end.character,
      )
      const message = d.hint ? `${d.message}\n${d.hint}` : d.message
      const diagnostic = new vscode.Diagnostic(
        range,
        message,
        d.severity === 'error'
          ? vscode.DiagnosticSeverity.Error
          : vscode.DiagnosticSeverity.Warning,
      )
      diagnostic.source = 'idocs'
      const list = byFile.get(d.file) ?? []
      list.push(diagnostic)
      byFile.set(d.file, list)
    }

    const before = this.reported.get(state.folder) ?? new Set()
    for (const file of before) if (!byFile.has(file)) this.diagnostics.delete(vscode.Uri.file(file))
    for (const [file, list] of byFile) this.diagnostics.set(vscode.Uri.file(file), list)
    this.reported.set(state.folder, new Set(byFile.keys()))
  }

  private clearDiagnostics(folder: string): void {
    for (const file of this.reported.get(folder) ?? []) {
      this.diagnostics.delete(vscode.Uri.file(file))
    }
    this.reported.delete(folder)
  }

  // -- What a file contains ---------------------------------------------------------------------

  /** The parsed form of a diagram or scenario file, from the editor's current text. */
  model(path: string, where?: Located): FileModel | undefined {
    const located = where ?? locate(path, this.fs, join)
    if (!located || (located.role !== 'diagram' && located.role !== 'scenario')) return undefined
    const text = this.fs.readText(path)
    if (text === undefined) return undefined

    const cached = this.parsed.get(path)
    if (cached?.text === text) return cached
    const parsed = new Parsed(text)
    const role: 'diagram' | 'scenario' = located.role
    const model = {
      path,
      role,
      scenarioId: located.id,
      parsed,
      declarations: role === 'diagram' ? declarationsOf(parsed) : [],
      refs: referencesIn(parsed, role),
      text,
    }
    this.parsed.set(path, model)
    return model
  }

  /** The `diagram.yaml` of a folder. */
  mainFile(folder: string): string | undefined {
    const fs = this.fs
    return DIAGRAM_FILES.map((f) => join(folder, f)).find((f) => fs.exists(f))
  }

  /** Every diagram and scenario file of a folder, parsed. */
  models(folder: string): FileModel[] {
    const fs = this.fs
    const main = this.mainFile(folder)
    const out: FileModel[] = []
    if (main) {
      const m = this.model(main)
      if (m) out.push(m)
    }
    const dir = join(folder, 'scenarios')
    for (const name of fs
      .readDir(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()) {
      const m = this.model(join(dir, name))
      if (m) out.push(m)
    }
    return out
  }

  /** What completion can offer: the ids declared in the folder, from the current text. */
  idsOf(folder: string): ProjectIds {
    const fs = this.fs
    const main = this.mainFile(folder)
    const decls = (main ? this.model(main)?.declarations : undefined) ?? []
    const of = (section: Declaration['section'], detailKey: string): Entity[] =>
      decls
        .filter((d) => d.section === section)
        .map((d) => ({ id: d.id, detail: d.props[detailKey] ?? d.props.title ?? d.props.label }))
    return {
      nodes: of('nodes', 'title'),
      groups: of('groups', 'label'),
      views: of('views', 'title'),
      customKinds: decls.filter((d) => d.section === 'kinds').map((d) => d.id),
      customEdgeKinds: decls.filter((d) => d.section === 'edgeKinds').map((d) => d.id),
      docs: fs
        .readDir(join(folder, 'nodes'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => `nodes/${f}`),
      // Not this one: a diagram cannot be inside itself.
      diagrams: sameProject(folder, this.states.values())
        .filter((s) => s.folder !== folder)
        .map((s) => ({ id: s.name, detail: s.lastGood?.title }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }
  }

  /** Role of a file, for callers that only have a path. */
  roleOf(path: string): FileRole | undefined {
    return locate(path, this.fs, join)?.role
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    for (const d of this.disposables) d.dispose()
  }
}
