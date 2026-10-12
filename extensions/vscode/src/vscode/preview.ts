// The live preview: one webview panel that shows the diagram of the file you are editing, follows
// you to other diagrams unless locked, and shows the node your cursor is in.
import { relative } from 'node:path'
import * as vscode from 'vscode'
import { sameProject } from '../model/links'
import { isInside } from '../model/paths'
import { contains, symbolAt } from '../model/references'
import { makeNonce, previewHtml } from '../preview/html'
import type { FromWebview, Problem, ToWebview } from '../preview/protocol'
import { type DiagramService, diagnosticsOf, type FolderState } from './service'
import { settings } from './settings'
import { toRange } from './symbols'

const VIEW_TYPE = 'idocs.preview'

export interface PreviewSnapshot {
  open: boolean
  ready: boolean
  folder?: string
  locked: boolean
  selected: string | null
  title?: string
  /** How many diagram messages have been sent to the page. */
  posted: number
}

interface SavedState {
  folder?: string
  locked?: boolean
}

export class PreviewManager implements vscode.Disposable {
  private panel?: vscode.WebviewPanel
  private target?: string
  private locked = false
  private ready = false
  private lastPosted = ''
  private posted = 0
  private selected: string | null = null
  private selectTimer?: NodeJS.Timeout
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: DiagramService,
  ) {
    this.disposables.push(
      service.onDidCompile((state) => this.onCompiled(state)),
      service.onDidRemove((folder) => {
        if (folder === this.target) this.empty('This diagram no longer exists.')
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onActiveEditor(editor)),
      vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('idocs.preview')) return
        // `refreshOn` may have just changed from `save` to `type`: show what is in the editor now.
        this.lastPosted = ''
        this.push()
        this.onSelectionSoon()
      }),
      vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        deserializeWebviewPanel: async (panel, state: SavedState | undefined) => {
          this.locked = !!state?.locked
          this.attach(panel)
          if (state?.folder) this.retarget(state.folder)
          else this.empty('Open a diagram file to preview it.')
        },
      }),
    )
  }

  get isOpen(): boolean {
    return !!this.panel
  }

  /** What the preview is doing, for the extension's own tests. */
  snapshot(): PreviewSnapshot {
    return {
      open: !!this.panel,
      ready: this.ready,
      folder: this.target,
      locked: this.locked,
      selected: this.selected,
      title: this.panel?.title,
      posted: this.posted,
    }
  }

  /** Open the preview for a diagram folder, or reveal and retarget the one that is open. */
  open(folder: string | undefined, column: vscode.ViewColumn): void {
    if (this.panel) {
      this.panel.reveal(column, true)
    } else {
      const panel = vscode.window.createWebviewPanel(
        VIEW_TYPE,
        'idocs preview',
        { viewColumn: column, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
        },
      )
      this.attach(panel)
    }
    if (folder) this.retarget(folder)
    else if (!this.target) this.empty('Open a diagram file to preview it.')
  }

  setLocked(locked: boolean): void {
    this.locked = locked
    void vscode.commands.executeCommand('setContext', 'idocs.previewLocked', locked)
    this.send({ type: 'lock', locked })
    this.updateTitle()
  }

  get isLocked(): boolean {
    return this.locked
  }

  refresh(): void {
    if (!this.target) return
    this.lastPosted = ''
    const state = this.service.compile(this.target)
    if (!state) this.empty('This diagram no longer exists.')
  }

  // -- Panel ------------------------------------------------------------------------------------

  private attach(panel: vscode.WebviewPanel): void {
    this.panel = panel
    this.ready = false
    this.lastPosted = ''
    const webview = panel.webview
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
    }
    const media = (file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', file))
    webview.html = previewHtml({
      nonce: makeNonce(),
      cspSource: webview.cspSource,
      script: media('main.js').toString(),
      style: media('main.css').toString(),
      title: 'idocs preview',
    })
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'icon-light.svg'),
      dark: vscode.Uri.joinPath(this.context.extensionUri, 'images', 'icon-dark.svg'),
    }

    panel.onDidDispose(() => {
      this.panel = undefined
      this.target = undefined
      this.ready = false
      void vscode.commands.executeCommand('setContext', 'idocs.previewOpen', false)
      void vscode.commands.executeCommand('setContext', 'idocs.previewLocked', false)
    })
    panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m))
    void vscode.commands.executeCommand('setContext', 'idocs.previewOpen', true)
    void vscode.commands.executeCommand('setContext', 'idocs.previewLocked', this.locked)
  }

  private send(message: ToWebview): void {
    if (!this.panel || !this.ready) return
    void this.panel.webview.postMessage(message)
  }

  private updateTitle(): void {
    if (!this.panel) return
    const name = this.target ? this.service.state(this.target)?.name : undefined
    this.panel.title = name ? `${this.locked ? '🔒 ' : ''}Preview ${name}` : 'idocs preview'
  }

  // -- What it shows ----------------------------------------------------------------------------

  private retarget(folder: string): void {
    const changed = folder !== this.target
    this.target = folder
    if (changed) {
      this.lastPosted = ''
      this.selected = null
    }
    if (!this.service.state(folder)) this.service.compile(folder)
    this.push()
  }

  private empty(message: string): void {
    this.target = undefined
    this.lastPosted = ''
    this.updateTitle()
    this.send({ type: 'empty', message })
  }

  private push(): void {
    if (!this.panel || !this.ready || !this.target) return
    const state = this.service.state(this.target)
    if (!state) return
    this.updateTitle()

    const message: ToWebview = {
      type: 'diagram',
      name: state.name,
      folder: state.folder,
      diagram: state.lastGood ?? null,
      nested: this.service.nested(state.folder),
      stale: !state.outcome.diagram,
      problems: problems(state),
      locked: this.locked,
    }
    // Typing a comment or whitespace compiles to the same diagram; do not make the webview lay it
    // out again for that.
    const serialized = JSON.stringify(message)
    if (serialized === this.lastPosted) return
    this.lastPosted = serialized
    this.posted++
    void this.panel.webview.postMessage(message)
    this.onSelectionSoon()
  }

  private onCompiled(state: FolderState): void {
    // A diagram of the same project may be one the previewed diagram opens.
    if (!this.target || !sameProject(this.target, [state]).length) return
    // In `save` mode only a save, not typing, brings the preview up to date.
    if (state.cause === 'edit' && settings().refreshOn === 'save') return
    this.push()
  }

  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!this.panel || this.locked || !editor) return
    const where = this.service.locate(editor.document.uri)
    if (where && where.folder !== this.target) this.retarget(where.folder)
    else this.onSelectionSoon()
  }

  // -- Editor to diagram ------------------------------------------------------------------------

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    if (e.textEditor === vscode.window.activeTextEditor) this.onSelectionSoon()
  }

  private onSelectionSoon(): void {
    clearTimeout(this.selectTimer)
    this.selectTimer = setTimeout(() => this.syncSelection(), 120)
  }

  /** Tell the diagram which node the cursor is in. */
  private syncSelection(): void {
    if (!this.panel || !this.ready || !this.target) return
    const node = settings().followCursor ? this.nodeAtCursor() : null
    if (node === this.selected) return
    this.selected = node
    this.send({ type: 'select', node })
  }

  private nodeAtCursor(): string | null {
    const editor = vscode.window.activeTextEditor
    if (!editor || !this.target) return null
    const where = this.service.locate(editor.document.uri)
    if (where?.folder !== this.target) return null
    if (where.role === 'node-doc' && where.id) return where.id

    const model = this.service.model(editor.document.uri.fsPath, where)
    const diagram = this.service.state(this.target)?.lastGood
    if (!model || !diagram) return null
    const pos = { line: editor.selection.active.line, character: editor.selection.active.character }

    const symbol = symbolAt(pos, model.refs, model.role === 'diagram' ? model.declarations : [])
    if (symbol?.namespace === 'member' && diagram.nodes[symbol.id]) return symbol.id
    // Anywhere inside a node's entry counts: its `kind:` line selects it too.
    const inside = model.declarations.find((d) => d.section === 'nodes' && contains(d.entry, pos))
    return inside && diagram.nodes[inside.id] ? inside.id : null
  }

  // -- Diagram to editor ------------------------------------------------------------------------

  private onMessage(message: FromWebview): void {
    // Messages come from the webview, which runs rendering code the extension does not control:
    // check their shape before acting on them.
    if (typeof message !== 'object' || message === null) return
    switch (message.type) {
      case 'ready':
        this.ready = true
        this.lastPosted = ''
        // A page that has just loaded has nothing outlined, whatever it showed before.
        this.selected = null
        this.send({ type: 'lock', locked: this.locked })
        if (this.target) this.push()
        else {
          const where = vscode.window.activeTextEditor
            ? this.service.locate(vscode.window.activeTextEditor.document.uri)
            : undefined
          if (where) this.retarget(where.folder)
          else this.empty('Open a diagram file to preview it.')
        }
        return
      case 'toggle-lock':
        this.setLocked(!this.locked)
        return
      case 'refresh':
        this.refresh()
        return
      case 'reveal-node':
        if (typeof message.id === 'string') this.guard(this.revealNode(message.id))
        return
      case 'reveal-problem':
        if (typeof message.file === 'string') {
          const { line, col } = message
          this.guard(
            this.revealFile(
              message.file,
              typeof line === 'number' ? line : undefined,
              typeof col === 'number' ? col : undefined,
            ),
          )
        }
        return
    }
  }

  /** Opening a file can fail (it was deleted, say); that is not worth an unhandled rejection. */
  private guard(work: Promise<void>): void {
    work.catch((error) => this.service.log.warn(`preview: ${String(error)}`))
  }

  private async revealNode(id: string): Promise<void> {
    if (!this.target) return
    const main = this.service.mainFile(this.target)
    const model = main ? this.service.model(main) : undefined
    const declared = model?.declarations.find(
      (d) => d.id === id && (d.section === 'nodes' || d.section === 'groups'),
    )
    if (!main || !declared) return
    await this.show(vscode.Uri.file(main), toRange(declared.key))
  }

  private async revealFile(file: string, line?: number, col?: number): Promise<void> {
    // Only files of the diagram being previewed: the message comes from a webview.
    if (!this.target) return
    // `isInside` also rejects another drive, which `relative` answers with an absolute path.
    if (!isInside(this.target, file) || file === this.target) return
    const pos = new vscode.Position(Math.max(0, (line ?? 1) - 1), Math.max(0, (col ?? 1) - 1))
    await this.show(vscode.Uri.file(file), new vscode.Range(pos, pos))
  }

  /** Open a file next to the preview, without taking focus from it. */
  private async show(uri: vscode.Uri, range: vscode.Range): Promise<void> {
    const visible = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.fsPath === uri.fsPath,
    )
    const previewColumn = this.panel?.viewColumn
    const column =
      visible?.viewColumn ??
      (previewColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One)
    await vscode.window.showTextDocument(uri, {
      viewColumn: column,
      selection: range,
      preserveFocus: true,
    })
  }

  dispose(): void {
    clearTimeout(this.selectTimer)
    this.panel?.dispose()
    for (const d of this.disposables) d.dispose()
  }
}

function problems(state: FolderState): Problem[] {
  return diagnosticsOf(state).map((d) => ({
    severity: d.severity,
    message: d.message,
    hint: d.hint,
    file: d.file,
    label: relative(state.folder, d.file) || d.file,
    line: d.line,
    col: d.col,
  }))
}
