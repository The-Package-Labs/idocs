// Runs inside VS Code's extension host, against a copy of integration/fixture, through
// scripts/integration.mjs. It drives the extension the way a person does: opening files,
// typing, asking for completions, and opening the preview.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as vscode from 'vscode'
import type { IdocsApi } from '../src/extension'

interface Case {
  name: string
  run(): Promise<void>
}
const cases: Case[] = []
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run })

const root = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
const file = (...parts: string[]) => vscode.Uri.file(join(root(), ...parts))

async function until<T>(
  what: string,
  check: () => T | Promise<T>,
  timeout = 10_000,
): Promise<NonNullable<T>> {
  const end = Date.now() + timeout
  for (;;) {
    const value = await check()
    if (value) return value as NonNullable<T>
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function open(...parts: string[]) {
  const doc = await vscode.workspace.openTextDocument(file(...parts))
  const editor = await vscode.window.showTextDocument(doc, { preview: false })
  return { doc, editor }
}

/** Where `needle` first appears, optionally `after` another string. */
function find(
  doc: vscode.TextDocument,
  needle: string,
  after?: string,
  inside = 0,
): vscode.Position {
  const text = doc.getText()
  const from = after ? text.indexOf(after) : 0
  assert.ok(from >= 0, `"${after}" not found`)
  const at = text.indexOf(needle, from)
  assert.ok(at >= 0, `"${needle}" not found`)
  return doc.positionAt(at + inside)
}

async function append(editor: vscode.TextEditor, text: string): Promise<vscode.Position> {
  const end = editor.document.lineAt(editor.document.lineCount - 1).range.end
  await editor.edit((e) => e.insert(end, text))
  return editor.document.lineAt(editor.document.lineCount - 1).range.end
}

const revert = () => vscode.commands.executeCommand('workbench.action.files.revert')

async function completions(uri: vscode.Uri, at: vscode.Position): Promise<string[]> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    uri,
    at,
  )
  return list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label))
}

const diagnosticsOf = (...parts: string[]) => vscode.languages.getDiagnostics(file(...parts))

let api: IdocsApi

// -- Starting up --------------------------------------------------------------------------------

test('activates and finds every diagram in the workspace', async () => {
  await api.ready
  const names = api.diagrams().map((d) => d.split(/[\\/]/).pop())
  assert.deepEqual(names, ['broken', 'docs', 'other', 'shop'])
})

test('treats diagram and scenario files as idocs, and other yaml as yaml', async () => {
  assert.equal((await open('diagrams', 'shop', 'diagram.yaml')).doc.languageId, 'idocs')
  assert.equal((await open('diagrams', 'shop', 'scenarios', 'refund.yaml')).doc.languageId, 'idocs')
  const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: 'a: 1' })
  assert.equal(doc.languageId, 'yaml')
})

// -- Problems -----------------------------------------------------------------------------------

test('shows the compiler errors in the Problems panel, on the word that is wrong', async () => {
  const found = await until('errors', () => {
    const d = diagnosticsOf('diagrams', 'broken', 'diagram.yaml')
    return d.length ? d : undefined
  })
  const unknown = found.find((d) => d.message.includes('nope'))
  assert.ok(unknown, `got: ${found.map((d) => d.message).join(' | ')}`)
  assert.equal(unknown.severity, vscode.DiagnosticSeverity.Error)
  assert.equal(unknown.source, 'idocs')
  assert.equal(unknown.range.start.line, 4)
  assert.equal(unknown.range.start.character, 4)
  assert.equal(unknown.range.end.character, 8)
})

test('then reports the next kind of error once the first is fixed', async () => {
  const { doc, editor } = await open('diagrams', 'broken', 'diagram.yaml')
  const line = doc.lineAt(find(doc, 'nope').line)
  await editor.edit((e) => e.delete(line.rangeIncludingLineBreak))
  const found = await until('the edge error', () =>
    diagnosticsOf('diagrams', 'broken', 'diagram.yaml').find((d) => d.message.includes('missing')),
  )
  assert.equal(doc.lineAt(found.range.start.line).text.includes('a -> missing'), true)
  await revert()
})

test('warns about a node that cites a file which does not exist', async () => {
  const found = await until('warning', () => {
    const d = diagnosticsOf('diagrams', 'shop', 'diagram.yaml').filter((x) =>
      x.message.includes('gone.ts'),
    )
    return d.length ? d : undefined
  })
  assert.equal(found[0]?.severity, vscode.DiagnosticSeverity.Warning)
  const { doc } = await open('diagrams', 'shop', 'diagram.yaml')
  assert.equal(doc.lineAt(found[0]?.range.start.line ?? 0).text.includes('src/gone.ts'), true)
})

test('checks text that is not saved yet, and clears the problem when it is fixed', async () => {
  const { doc, editor } = await open('diagrams', 'other', 'diagram.yaml')
  const at = find(doc, 'One')
  await editor.edit((e) =>
    e.replace(new vscode.Range(at, at.translate(0, 3)), '{ title: One, nope: 1 }'),
  )
  assert.equal(doc.isDirty, true)
  await until('an error for the unsaved text', () =>
    diagnosticsOf('diagrams', 'other', 'diagram.yaml').find(
      (d) => d.severity === vscode.DiagnosticSeverity.Error,
    ),
  )
  await revert()
  await until(
    'the error to clear',
    () => diagnosticsOf('diagrams', 'other', 'diagram.yaml').length === 0,
  )
})

test('shows the state of the diagram being edited in the status bar', async () => {
  await open('diagrams', 'broken', 'diagram.yaml')
  const bad = await until('an error count', () => {
    const s = api.status()
    return s.visible && s.text?.includes('$(error)') ? s : undefined
  })
  assert.equal(bad.command, 'workbench.actions.view.problems')
  assert.match(bad.tooltip ?? '', /^broken: \d+ errors?/)

  await open('diagrams', 'other', 'diagram.yaml')
  const good = await until('a clean status', () => {
    const s = api.status()
    return s.text === '$(check) idocs' ? s : undefined
  })
  assert.equal(good.command, 'idocs.openPreviewToSide')
  assert.match(good.tooltip ?? '', /2 nodes, 1 edge, 0 scenarios/)

  const plain = await vscode.workspace.openTextDocument({ language: 'yaml', content: 'a: 1' })
  await vscode.window.showTextDocument(plain)
  await until('the entry to hide', () => !api.status().visible)
})

// -- Completion ---------------------------------------------------------------------------------

test('completes node ids at the start of an edge and after its arrow', async () => {
  const { doc, editor } = await open('diagrams', 'other', 'diagram.yaml')
  const start = await append(editor, '\nscenarios:\n  s:\n    steps:\n      - ')
  const first = await completions(doc.uri, start)
  assert.ok(
    ['one', 'two', 'at', 'par'].every((l) => first.includes(l)),
    first.join(','),
  )
  const arrow = await append(editor, 'one -> ')
  const second = await completions(doc.uri, arrow)
  assert.ok(second.includes('two'))
  assert.ok(!second.includes('one'))
  await revert()
})

test('completes keys, kinds and icon names', async () => {
  const { doc, editor } = await open('diagrams', 'other', 'diagram.yaml')
  const key = await append(editor, '\n  three:\n    ')
  assert.ok((await completions(doc.uri, key)).includes('kind'))
  const kind = await append(editor, 'kind: ')
  assert.ok((await completions(doc.uri, kind)).includes('database'))
  const icon = await append(editor, '\n    icon: postgre')
  assert.ok((await completions(doc.uri, icon)).includes('postgresql'))
  await revert()
})

// -- Reading ------------------------------------------------------------------------------------

test('describes a node on hover', async () => {
  const { doc } = await open('diagrams', 'shop', 'diagram.yaml')
  const at = find(doc, 'api', '  - web -> ', 1)
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    doc.uri,
    at,
  )
  const text = hovers
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === 'string' ? c : c.value))
    .join('\n')
  assert.match(text, /\*\*API\*\*/)
  assert.match(text, /service/)
  assert.match(text, /:8080/)
})

test('goes to where a node is declared, from the diagram and from a scenario file', async () => {
  const declared = find(
    (await open('diagrams', 'shop', 'diagram.yaml')).doc,
    'api',
    '\nnodes:\n  web',
    0,
  )
  for (const [parts, needle, after] of [
    [['diagrams', 'shop', 'diagram.yaml'], 'api', '  - web -> '],
    [['diagrams', 'shop', 'scenarios', 'refund.yaml'], 'api', 'POST /refunds'],
  ] as const) {
    const { doc } = await open(...parts)
    const at =
      after === 'POST /refunds' ? find(doc, 'at api', undefined, 4) : find(doc, needle, after, 1)
    const found = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeDefinitionProvider',
      doc.uri,
      at,
    )
    assert.equal(found.length, 1, parts.join('/'))
    assert.equal(found[0]?.uri.fsPath, file('diagrams', 'shop', 'diagram.yaml').fsPath)
    assert.equal(found[0]?.range.start.line, declared.line)
  }
})

test('finds every use of a node, across files', async () => {
  const { doc } = await open('diagrams', 'shop', 'diagram.yaml')
  const at = find(doc, 'api', '\nnodes:\n  web')
  const refs = await vscode.commands.executeCommand<vscode.Location[]>(
    'vscode.executeReferenceProvider',
    doc.uri,
    at,
  )
  const files = new Set(refs.map((r) => r.uri.fsPath.split(/[\\/]/).slice(-2).join('/')))
  assert.ok(files.has('shop/diagram.yaml'))
  assert.ok(files.has('scenarios/refund.yaml'), [...files].join(','))
})

test('lists the structure of a file in the outline', async () => {
  const { doc } = await open('diagrams', 'shop', 'diagram.yaml')
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    doc.uri,
  )
  const nodes = symbols.find((s) => s.name === 'nodes')
  assert.deepEqual(
    nodes?.children.map((c) => c.name),
    ['web', 'api', 'db'],
  )
  assert.ok(symbols.some((s) => s.name === 'scenarios'))
})

// -- The preview --------------------------------------------------------------------------------

const webviewTabs = () =>
  vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter(
      (t) =>
        t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith('idocs.preview'),
    )

test('opens the preview beside the editor and shows the diagram being edited', async () => {
  await open('diagrams', 'shop', 'diagram.yaml')
  await vscode.commands.executeCommand('idocs.openPreviewToSide')
  const state = await until(
    'the preview to load',
    () => {
      const s = api.preview()
      return s.open && s.ready ? s : undefined
    },
    20_000,
  )
  assert.ok(state.folder?.endsWith('shop'))
  assert.equal(webviewTabs().length, 1)
  assert.match(webviewTabs()[0]?.label ?? '', /Preview shop/)
})

test('follows you to another diagram', async () => {
  await open('diagrams', 'other', 'diagram.yaml')
  await until('the preview to retarget', () => api.preview().folder?.endsWith('other'))
  assert.equal(webviewTabs().length, 1)
})

test('stays on its diagram while locked, and follows again when unlocked', async () => {
  await vscode.commands.executeCommand('idocs.lockPreview')
  assert.equal(api.preview().locked, true)
  await open('diagrams', 'shop', 'diagram.yaml')
  await new Promise((r) => setTimeout(r, 400))
  assert.ok(api.preview().folder?.endsWith('other'), 'a locked preview must not move')
  await vscode.commands.executeCommand('idocs.unlockPreview')
  assert.equal(api.preview().locked, false)
  await open('diagrams', 'other', 'diagram.yaml')
  await open('diagrams', 'shop', 'diagram.yaml')
  await until('the preview to follow again', () => api.preview().folder?.endsWith('shop'))
})

test('outlines the node the cursor is in', async () => {
  const { doc, editor } = await open('diagrams', 'shop', 'diagram.yaml')
  const at = find(doc, 'kind: database')
  editor.selection = new vscode.Selection(at, at)
  await until('the database to be outlined', () => api.preview().selected === 'db')
  const title = find(doc, 'title: The shop')
  editor.selection = new vscode.Selection(title, title)
  await until('the outline to clear', () => api.preview().selected === null)
})

test('only updates when a file is saved, if that is what you asked for', async () => {
  const config = vscode.workspace.getConfiguration('idocs')
  await config.update('preview.refreshOn', 'save', vscode.ConfigurationTarget.Workspace)
  try {
    const { doc, editor } = await open('diagrams', 'other', 'diagram.yaml')
    await until('the preview to follow', () => api.preview().folder?.endsWith('other'))
    const before = api.preview().posted
    const at = find(doc, 'Two')
    await editor.edit((e) => e.replace(new vscode.Range(at, at.translate(0, 3)), 'Second'))
    await new Promise((r) => setTimeout(r, 900))
    assert.equal(api.preview().posted, before, 'typing must not update the preview')
    await doc.save()
    await until('the saved text to reach the preview', () => api.preview().posted > before)
    // Put the file back as it was.
    await editor.edit((e) => e.replace(new vscode.Range(at, at.translate(0, 6)), 'Two'))
    await doc.save()
  } finally {
    await config.update('preview.refreshOn', undefined, vscode.ConfigurationTarget.Workspace)
  }
})

test('closes cleanly', async () => {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  await until('the preview to close', () => !api.preview().open)
  assert.equal(webviewTabs().length, 0)
})

// -- Rename (last: it changes the fixture) --------------------------------------------------------

test('renames a node everywhere, including its documentation file', async () => {
  const { doc } = await open('diagrams', 'shop', 'diagram.yaml')
  const at = find(doc, 'api', '\nnodes:\n  web')
  await assert.rejects(
    Promise.resolve(
      vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', doc.uri, at, 'web'),
    ),
    /already used/,
  )
  const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    doc.uri,
    at,
    'gateway',
  )
  assert.equal(await vscode.workspace.applyEdit(edit, { isRefactoring: true }), true)
  // Files that were not open stay unsaved background buffers until someone saves them.
  for (const d of vscode.workspace.textDocuments) if (d.isDirty) await d.save()

  const main = readFileSync(file('diagrams', 'shop', 'diagram.yaml').fsPath, 'utf8')
  assert.match(main, /^ {2}gateway:/m)
  assert.match(main, /web -> gateway: HTTPS/)
  assert.match(main, /gateway -> db/)
  assert.doesNotMatch(main, /\bapi\b -> /)
  const scenario = readFileSync(file('diagrams', 'shop', 'scenarios', 'refund.yaml').fsPath, 'utf8')
  assert.match(scenario, /web -> gateway: POST/)
  assert.match(scenario, /at gateway: check/)
  assert.equal(existsSync(file('diagrams', 'shop', 'nodes', 'gateway.md').fsPath), true)
  assert.equal(existsSync(file('diagrams', 'shop', 'nodes', 'api.md').fsPath), false)
  // Still a valid diagram afterwards.
  await until('no errors after the rename', () =>
    diagnosticsOf('diagrams', 'shop', 'diagram.yaml').every(
      (d) => d.severity !== vscode.DiagnosticSeverity.Error,
    ),
  )
})

test('renames a node, its documentation file and the doc: that names it', async () => {
  const { doc } = await open('diagrams', 'docs', 'diagram.yaml')
  const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    doc.uri,
    find(doc, 'alpha', '\nnodes:'),
    'first',
  )
  assert.equal(await vscode.workspace.applyEdit(edit, { isRefactoring: true }), true)
  for (const d of vscode.workspace.textDocuments) if (d.isDirty) await d.save()

  const text = readFileSync(file('diagrams', 'docs', 'diagram.yaml').fsPath, 'utf8')
  assert.match(text, /^ {2}first:/m)
  assert.match(text, /doc: \.\/nodes\/first\.md/)
  assert.match(text, /first -> beta/)
  assert.equal(existsSync(file('diagrams', 'docs', 'nodes', 'first.md').fsPath), true)
  assert.equal(existsSync(file('diagrams', 'docs', 'nodes', 'alpha.md').fsPath), false)
})

test('leaves a doc: that points somewhere else where it is', async () => {
  const { doc } = await open('diagrams', 'docs', 'diagram.yaml')
  const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
    'vscode.executeDocumentRenameProvider',
    doc.uri,
    find(doc, 'beta', '\nnodes:'),
    'second',
  )
  assert.equal(await vscode.workspace.applyEdit(edit, { isRefactoring: true }), true)
  for (const d of vscode.workspace.textDocuments) if (d.isDirty) await d.save()
  assert.match(
    readFileSync(file('diagrams', 'docs', 'diagram.yaml').fsPath, 'utf8'),
    /doc: notes\/beta\.md/,
  )
  assert.equal(existsSync(file('diagrams', 'docs', 'notes', 'beta.md').fsPath), true)
})

test('checks every diagram on request', async () => {
  await vscode.commands.executeCommand('idocs.checkAll')
})

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<IdocsApi>('thepackagelabs.idocs-vscode')
  assert.ok(extension, 'the extension is not installed')
  api = await extension.activate()

  const failures: string[] = []
  for (const c of cases) {
    try {
      await c.run()
      console.log(`  ok    ${c.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`  FAIL  ${c.name}\n        ${message.split('\n').join('\n        ')}`)
      failures.push(c.name)
    }
  }
  console.log(`${cases.length - failures.length}/${cases.length} passed`)
  if (failures.length) throw new Error(`${failures.length} failed: ${failures.join('; ')}`)
}
