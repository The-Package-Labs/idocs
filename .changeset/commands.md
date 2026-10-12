---
"@the-package-labs/idocs-core": minor
"@the-package-labs/idocs-react": minor
"@the-package-labs/idocs-astro": minor
"@the-package-labs/idocs": minor
---

Code blocks that look like code blocks, and commands you can copy with values the reader fills in first. Every fenced block in a node's Markdown, a step's `note:` or a view's `summary:` is drawn with the language in a header (`title="..."` in the fence adds a caption), the code in colour, and icon buttons with tooltips: **copy**, and **fill in**. Shell, YAML, JSON, HTTP and INI/TOML/`.env` are highlighted properly, other common languages get strings, numbers and comments, and the colours are the theme's own tokens, so both themes and restyled diagrams follow. In a shell, plain-text or configuration block, a word in `{braces}` or `<angle brackets>` is a placeholder: fill in opens a field for each, the command shows the values as they are typed, and Copy uses them. `{Token}`, `<token>` and `<TOKEN>` are one value, and the same value fills every command on the page, in the diagrams and in the docs. Values are remembered in the browser, except secrets (a name with `token`, `pat`, `jwt`, `key`, `secret` or `password` in it), which are masked, kept in memory and never saved.

`${HOME}`, `{{ name }}`, `{a,b}` and JSON are left alone; `\{name}` writes the braces themselves, and `vars` or `novars` after the language of a fence turn detection on or off.

For a docs page there is `<Command code="git clone {repo}" />`, from `@the-package-labs/idocs-astro/Command.astro`. Core exports `highlight`, `splitPlaceholders`, `fillPlaceholders` and the rest of the model, and React exports `CommandBlock` and `Markup`.
