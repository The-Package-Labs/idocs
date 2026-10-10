# Changelog

## 0.2.0

- Renamed from docspp to idocs, and moved to [The-Package-Labs/idocs](https://github.com/The-Package-Labs/idocs). The extension id is now `thepackagelabs.idocs-vscode`; uninstall `packagelab.docspp-vscode`. The language id is `idocs`, commands and settings start with `idocs.` (copy any `docspp.*` settings across), and Markdown fences are `idocs`.

## 0.1.0

First release, published as `packagelab.docspp-vscode`.

- Syntax highlighting for diagram and scenario files, and for `docspp` fences in Markdown.
- Live preview in a webview: updates as you type, keeps the last good diagram, follows the cursor and the active diagram.
- Problems as you type, with the same checks as `docspp check`.
- Completion, hover, go to definition, find references, rename, outline and snippets.
- Commands to create a diagram, insert an icon and check every diagram.
- Status bar entry with the state of the diagram being edited, and a Get started walkthrough.
