import * as vscode from 'vscode'
import { statusCommand, statusText, statusTooltip, summarize } from '../model/summary'
import { type DiagramService, diagnosticsOf } from './service'

export interface StatusSnapshot {
  visible: boolean
  text?: string
  tooltip?: string
  command?: string
}

/** A status bar entry for the diagram being edited: problems at a glance, a click to act on them. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'idocs.status',
    vscode.StatusBarAlignment.Right,
    90,
  )
  private readonly disposables: vscode.Disposable[] = []
  private snapshot: StatusSnapshot = { visible: false }

  constructor(private readonly service: DiagramService) {
    this.item.name = 'idocs'
    this.disposables.push(
      this.item,
      service.onDidCompile(() => this.update()),
      service.onDidRemove(() => this.update()),
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
    )
    this.update()
  }

  get current(): StatusSnapshot {
    return this.snapshot
  }

  private update(): void {
    const editor = vscode.window.activeTextEditor
    const where = editor ? this.service.locate(editor.document.uri) : undefined
    const state = where ? this.service.state(where.folder) : undefined
    if (!state) {
      this.item.hide()
      this.snapshot = { visible: false }
      return
    }
    const summary = summarize(state.name, state.lastGood, diagnosticsOf(state))
    this.item.text = statusText(summary)
    this.item.tooltip = statusTooltip(summary)
    this.item.command = statusCommand(summary)
    this.item.backgroundColor = summary.errors
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : undefined
    this.item.show()
    this.snapshot = {
      visible: true,
      text: this.item.text,
      tooltip: this.item.tooltip,
      command: this.item.command,
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
