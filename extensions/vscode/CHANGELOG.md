# Changelog

## 0.3.0

- Nested diagrams. A node with `diagram: <name>` shows **Expand** (the whole inner diagram in place, as a group) and **Open** (move into it, with a trail back) in the preview, and clicking it shows the diagram as a picture in the side panel; and the preview follows edits to the diagrams it holds.
- The viewer can be resized by dragging its bottom edge, and expanded to most of the window.
- Problems for nodes that open a diagram that does not exist, or a view or scenario it does not have, or that lead back to themselves, as `idocs check` reports them.
- Completion offers the other diagrams of the project after `diagram:`.

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
