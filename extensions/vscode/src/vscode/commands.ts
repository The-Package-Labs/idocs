import { basename, dirname, join } from 'node:path'
import * as vscode from 'vscode'
import { iconImage } from '../language/hover'
import { isInside } from '../model/paths'
import { NAME_PATTERN, newDiagramFiles } from '../model/scaffold'
import type { PreviewManager } from './preview'
import { type DiagramService, diagnosticsOf } from './service'

export function registerCommands(
  service: DiagramService,
  preview: PreviewManager,
  output: vscode.OutputChannel,
): vscode.Disposable[] {
  const register = (id: string, run: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(`idocs.${id}`, run as (...args: unknown[]) => unknown)

  return [
    register('openPreview', async (uri?: vscode.Uri) => {
      const folder = await pickFolder(service, uri)
      if (folder) preview.open(folder, vscode.ViewColumn.Active)
    }),
    register('openPreviewToSide', async (uri?: vscode.Uri) => {
      const folder = await pickFolder(service, uri)
      if (folder) preview.open(folder, vscode.ViewColumn.Beside)
    }),
    register('lockPreview', () => preview.setLocked(true)),
    register('unlockPreview', () => preview.setLocked(false)),
    register('refreshPreview', () => preview.refresh()),
    register('newDiagram', () => newDiagram(service, preview)),
    register('insertIcon', () => insertIcon(service)),
    register('checkAll', () => checkAll(service)),
    register('showOutput', () => output.show(true)),
  ]
}

/** The diagram a command applies to: the one given, the one being edited, or one the user picks. */
async function pickFolder(service: DiagramService, uri?: vscode.Uri): Promise<string | undefined> {
  const given = uri ?? vscode.window.activeTextEditor?.document.uri
  const where = given ? service.locate(given) : undefined
  if (where) return where.folder
  // A diagram folder given from the explorer.
  if (uri && service.mainFile(uri.fsPath)) return uri.fsPath

  const folders = service.folders
  if (folders.length === 1) return folders[0]
  if (folders.length === 0) {
    const choice = await vscode.window.showInformationMessage(
      'No idocs diagram was found in this workspace.',
      'New Diagram',
    )
    if (choice) void vscode.commands.executeCommand('idocs.newDiagram')
    return undefined
  }
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: basename(folder),
      description: vscode.workspace.asRelativePath(folder),
      folder,
    })),
    { placeHolder: 'Which diagram?' },
  )
  return picked?.folder
}

// -- New diagram --------------------------------------------------------------------------------

async function newDiagram(service: DiagramService, preview: PreviewManager): Promise<void> {
  const roots = vscode.workspace.workspaceFolders ?? []
  if (!roots.length) {
    void vscode.window.showWarningMessage('Open a folder first, then create a diagram in it.')
    return
  }
  const name = await vscode.window.showInputBox({
    title: 'New idocs diagram',
    prompt: 'Name of the diagram: lowercase letters, digits and dashes',
    placeHolder: 'checkout-flow',
    validateInput: (value) =>
      NAME_PATTERN.test(value) ? undefined : 'Use lowercase letters, digits and dashes.',
  })
  if (!name) return

  const root =
    roots.length === 1
      ? roots[0]
      : (
          await vscode.window.showQuickPick(
            roots.map((r) => ({ label: r.name, root: r })),
            { placeHolder: 'Create the diagram in which folder?' },
          )
        )?.root
  if (!root) return

  // Next to the diagrams the workspace already has, otherwise in ./diagrams.
  const existing = service.folders.find((f) => isInside(root.uri.fsPath, f))
  const base = existing ? dirname(existing) : join(root.uri.fsPath, 'diagrams')
  const folder = join(base, name)
  const fs = vscode.workspace.fs
  if (service.fs.exists(folder)) {
    void vscode.window.showErrorMessage(
      `${vscode.workspace.asRelativePath(folder)} already exists.`,
    )
    return
  }
  for (const file of newDiagramFiles(name)) {
    const target = vscode.Uri.file(join(folder, file.path))
    await fs.createDirectory(vscode.Uri.file(dirname(target.fsPath)))
    await fs.writeFile(target, new TextEncoder().encode(file.content))
  }
  const main = vscode.Uri.file(join(folder, 'diagram.yaml'))
  await vscode.window.showTextDocument(main)
  service.compile(folder)
  preview.open(folder, vscode.ViewColumn.Beside)
}

// -- Icons --------------------------------------------------------------------------------------

async function insertIcon(service: DiagramService): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  const { icons } = service

  type Item = vscode.QuickPickItem & { id?: string }
  const pick = vscode.window.createQuickPick<Item>()
  pick.title = 'Insert icon'
  pick.placeholder = 'Search: postgresql, redis, kubernetes, server...'
  pick.matchOnDescription = false
  const update = (query: string) => {
    pick.items = query.trim()
      ? icons.searchIcons(query.trim(), 60).map((id) => {
          const resolved = icons.resolveIcon(id).icon
          return {
            label: id.slice(id.indexOf(':') + 1),
            description: id.slice(0, id.indexOf(':')),
            id,
            iconPath: resolved ? iconUri(resolved) : undefined,
          }
        })
      : []
  }
  pick.onDidChangeValue(update)
  const chosen = await new Promise<Item | undefined>((resolve) => {
    pick.onDidAccept(() => resolve(pick.selectedItems[0]))
    pick.onDidHide(() => resolve(undefined))
    pick.show()
  })
  pick.dispose()
  if (!chosen?.id) return

  const name = chosen.id.slice(chosen.id.indexOf(':') + 1)
  // The short form is what the docs show; use it when it means the same icon.
  const resolved = icons.resolveIcon(name).icon
  const text = resolved && `${resolved.set}:${resolved.name}` === chosen.id ? name : chosen.id
  await editor.edit((edit) => {
    for (const selection of editor.selections) edit.replace(selection, text)
  })
}

function iconUri(icon: NonNullable<ReturnType<DiagramService['icons']['resolveIcon']>['icon']>) {
  const image = iconImage(icon)
  const data = /\((data:[^)]+)\)/.exec(image)?.[1]
  return data ? vscode.Uri.parse(data) : undefined
}

// -- Check everything ---------------------------------------------------------------------------

async function checkAll(service: DiagramService): Promise<void> {
  // `discover` compiles every diagram it finds; compile the ones it did not, such as a diagram
  // that was opened from outside `diagrams/`.
  const fresh = new Set(await service.discover())
  for (const folder of service.folders) if (!fresh.has(folder)) service.compile(folder)
  let errors = 0
  let warnings = 0
  const folders = service.folders
  for (const folder of folders) {
    for (const d of diagnosticsOf(service.state(folder)!)) {
      if (d.severity === 'error') errors++
      else warnings++
    }
  }
  const count = `${folders.length} diagram${folders.length === 1 ? '' : 's'}`
  if (!folders.length) {
    void vscode.window.showInformationMessage('No idocs diagrams found in this workspace.')
  } else if (errors + warnings === 0) {
    void vscode.window.showInformationMessage(`idocs: ${count} checked, no problems.`)
  } else {
    void vscode.window
      .showWarningMessage(
        `idocs: ${count} checked, ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.`,
        'Show Problems',
      )
      .then((choice) => {
        if (choice) void vscode.commands.executeCommand('workbench.actions.view.problems')
      })
  }
}
