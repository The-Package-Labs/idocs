import * as vscode from 'vscode'
import { complete, type Suggestion, type SuggestionKind } from '../language/completion'
import type { DiagramService } from './service'

const KINDS: Record<SuggestionKind, vscode.CompletionItemKind> = {
  property: vscode.CompletionItemKind.Property,
  value: vscode.CompletionItemKind.EnumMember,
  node: vscode.CompletionItemKind.Class,
  group: vscode.CompletionItemKind.Module,
  view: vscode.CompletionItemKind.Interface,
  diagram: vscode.CompletionItemKind.Folder,
  icon: vscode.CompletionItemKind.Color,
  keyword: vscode.CompletionItemKind.Keyword,
  file: vscode.CompletionItemKind.File,
}

export function registerCompletion(service: DiagramService): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    { language: 'idocs', scheme: 'file' },
    {
      provideCompletionItems(document, position) {
        const where = service.locate(document.uri)
        if (!where || (where.role !== 'diagram' && where.role !== 'scenario')) return undefined

        const icons = service.icons
        const result = complete({
          text: document.getText(),
          position: { line: position.line, character: position.character },
          file: where.role,
          ids: service.idsOf(where.folder),
          icons: {
            search: (q, limit) => icons.searchIcons(q, limit),
            resolve: (spec) => {
              const icon = icons.resolveIcon(spec).icon
              return icon ? `${icon.set}:${icon.name}` : undefined
            },
          },
        })
        if (!result) return undefined

        const range = new vscode.Range(
          result.range.line,
          result.range.start,
          result.range.line,
          result.range.end,
        )
        return result.items.map((s, i) => item(s, range, i))
      },
    },
    ' ',
    ':',
    '[',
    ',',
  )
}

function item(s: Suggestion, range: vscode.Range, index: number): vscode.CompletionItem {
  const out = new vscode.CompletionItem(s.label, KINDS[s.kind])
  out.range = range
  out.insertText = s.insertText ?? s.label
  out.detail = s.detail
  if (s.filterText) out.filterText = s.filterText
  if (s.documentation) out.documentation = new vscode.MarkdownString(s.documentation)
  // Keep the order we chose (schema order for keys) instead of alphabetical.
  out.sortText = String(index).padStart(4, '0')
  if (s.retrigger) {
    out.command = { command: 'editor.action.triggerSuggest', title: 'Suggest' }
  }
  return out
}
