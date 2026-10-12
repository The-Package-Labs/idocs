---
"@the-package-labs/idocs-core": minor
"@the-package-labs/idocs-react": minor
"@the-package-labs/idocs-astro": minor
"@the-package-labs/idocs": minor
---

Commands you can copy, with values the reader fills in first. Every fenced block in a node's Markdown, a step's `note:` or a view's `summary:` gets a **Copy** button. In a shell, plain-text or configuration block, a word in `{braces}` or `<angle brackets>` is a placeholder: **Fill in** opens a field for each, the command shows the values as they are typed, and Copy uses them. `{Token}`, `<token>` and `<TOKEN>` are one value, and the same value fills every command on the page, in the diagrams and in the docs. Values are remembered in the browser, except secrets (a name with `token`, `pat`, `jwt`, `key`, `secret` or `password` in it), which are masked, kept in memory and never saved.

`${HOME}`, `{{ name }}`, `{a,b}` and JSON are left alone; `\{name}` writes the braces themselves, and `vars` or `novars` after the language of a fence turn detection on or off.

For a docs page there is `<Command code="git clone {repo}" />`, from `@the-package-labs/idocs-astro/Command.astro`. Core exports `splitPlaceholders`, `fillPlaceholders` and the rest of the model, and React exports `CommandBlock` and `Markup`.
