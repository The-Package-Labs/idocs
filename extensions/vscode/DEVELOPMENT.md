# Developing the extension

```sh
pnpm install
pnpm vscode:build                       # dist/ (extension host, webview, icon sets)
pnpm --filter idocs-vscode watch       # rebuild on change
```

Press <kbd>F5</kbd> in the repository root and pick **idocs extension (apps/docs)**. It builds the extension and opens a second VS Code on `apps/docs`, which has a dozen real diagrams.

## How it is laid out

```
extensions/vscode/
  package.json               the manifest: language, grammar, commands, menus, settings
  language-configuration.json  comments, brackets, indentation, folding
  syntaxes/                  TextMate grammars. idocs.tmLanguage.json is GENERATED
  snippets/                  snippets for the idocs language
  images/                    marketplace icon (generated), panel icons, README screenshot
  scripts/
    build.mjs                esbuild: host bundle, webview bundle, copies the icon sets
    grammar.mjs              generates syntaxes/idocs.tmLanguage.json
    icon.mjs                 renders images/icon.png
    package.mjs              builds for production and packs the .vsix
    integration.mjs          runs integration/ inside a real VS Code
  src/
    model/                   pure: diagram folders, YAML, references, outline, compile
    language/                pure: completion, cursor context, hover, vocabulary
    preview/                 the host/webview message protocol and the page's HTML
    vscode/                  the only code that imports `vscode`: adapters and the preview
    extension.ts             activate()
  webview/                   the preview page: React, DiagramView, theme.css
  test/                      unit tests (vitest): everything in model/ and language/, the grammar
  e2e/                       the webview in Chrome, under the real content security policy
  integration/               the extension in a real VS Code
```

The rule that keeps it testable: **`src/model` and `src/language` never import `vscode`.** They take text and positions and return plain data. `src/vscode` converts that to editor types and is exercised by `integration/`.

## Tests

| Command | What it covers |
|---|---|
| `pnpm test` | unit tests, including the grammar against the real YAML parser and the compile path against `loadProject` |
| `pnpm test:e2e` | the preview page in Chrome (also runs the docs site tests) |
| `pnpm vscode:test` | the extension in a real VS Code: language detection, problems, completion, rename, the preview panel |
| `pnpm --filter idocs-vscode test:integration --vsix` | the same, but installs the packed `.vsix` into a clean profile first |

`vscode:test` opens a VS Code window while it runs. It uses the VS Code installed on your machine (`VSCODE_EXECUTABLE` overrides), or downloads one. Started from a VS Code terminal it needs `ELECTRON_RUN_AS_NODE` unset, which the script checks for.

## Things that are easy to get wrong

- **The grammar is generated.** Edit `scripts/grammar.mjs`, run `pnpm --filter idocs-vscode grammar`, commit both. A test fails when they differ. Another test tokenizes every diagram in the repository and compares what it finds with the `yaml` parser.
- **Completion works on text that does not parse**, so it reads indentation (`src/language/context.ts`) instead of the YAML tree. Navigation, rename and outline use the tree.
- **The extension bundles its own compiler.** `@the-package-labs/idocs-core` is built into `dist/extension.js`, so a diagram that uses a key newer than the extension reports it as unknown. Release the extension after the packages when the format changes.
- **Do not import `@the-package-labs/idocs-core/node`.** Its icon loader resolves files with `import.meta.url`, which a CommonJS bundle cannot do. Use the `browser` entry and pass it the icon sets (`src/model/icons.ts`).
- **`src/model/sources.ts` mirrors `loadProject`.** A test compiles every example diagram both ways and requires identical output. `src/model/scaffold.ts` mirrors `idocs new` the same way.
- **The webview may only run scripts with the nonce.** `src/preview/html.ts` sets the policy and `e2e/` loads the same page, so a dependency that wants `eval` fails there first.

## Releasing

The extension is versioned on its own (`version` in `package.json`, notes in `CHANGELOG.md`) and is not part of the changesets release of the npm packages.

1. Update `CHANGELOG.md` and `version`, then merge.
2. Tag `vscode-v<version>`. The **VS Code extension** workflow tests it, packs the `.vsix`, attaches it to a GitHub release, and publishes it when the repository variable `VSCODE_PUBLISH` is `true` and the secrets `VSCE_PAT` (Visual Studio Marketplace) and `OVSX_PAT` (Open VSX) are set.

The `publisher` field in `package.json` must match the publisher on each marketplace. On Open VSX the `thepackagelabs` namespace exists: 0.2.0 was published there on 2026-10-10 (by hand, with `ovsx publish`), and 0.1.0 is listed under the old id `packagelab.docspp-vscode`. Before the first Visual Studio Marketplace release, create the `thepackagelabs` publisher at https://marketplace.visualstudio.com/manage.
