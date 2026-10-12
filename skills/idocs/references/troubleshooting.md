# Troubleshooting

Run `idocs check --json` first. Each message has a file, line, column and often a hint.

## Diagram errors

| Message | Fix |
|---|---|
| `Edge from "x" is not a node` / `Edge to "x" ...` | A typo or an undeclared node. The hint names the nearest id. |
| `"x" is not a node` (in a scenario) | Same, inside a step, `via`, `lanes` or a view's `include`. |
| `No path from "a" to "b" in view "v"` | The step needs a route. Declare an edge between them (it can be `hidden: true`), or add `via: [...]` through nodes that are connected. |
| `Node "x" is not in view "v"` | The scenario's view does not include `x`. Add it to `include`, or set the scenario's `view:`. |
| `Unknown key "titel"` | A typo. The hint suggests the right key; the message lists allowed keys. |
| `Not a recognised step` | Steps are `a -> b: label`, `at node: label`, or `par:` with a list. Check spacing and the arrow. |
| `A step with at needs a label or a title` | `at x:` needs text: `at x: what happens`. |
| `"x" is not a direct member of group "g"` | Entries in a group's `rows:` must be nodes or groups whose `in:` is that group. |
| `Groups are nested in a cycle` | A group's `in:` chain loops back on itself. |
| `Node "x" opens diagram "y", which does not exist` | The `diagram:` name must be a folder under `diagrams/`. The hint names the nearest one. |
| `Diagram "y" has no view "v"` / `... no scenario "s"` | The `view` or `scenario` in a node's long-form `diagram:` is not in that diagram. The hint lists what it has. |
| `Scenario "s" plays on view "a", not "b"` | A node's `diagram:` names both, and they disagree. Drop `view` and it opens on the scenario's own view. |
| `Node "x" opens "y", which leads back to "z"` / `... opens its own diagram` | Diagrams cannot nest in a circle. The hint shows the loop; break it at one node. |
| warning `` `expanded` has no effect with `mode: open` `` | A node limited to `mode: open` cannot start expanded. Use `mode: expand` or `both`, or drop `expanded`. |
| `Edge id "e" is used twice` | Give edges distinct ids or drop the ids. |
| `Unknown edge kind "x"` | Use a built-in kind or define it under `edgeKinds:`. |
| warning `Unknown icon "x"` | `idocs icons search x`, then use the suggested name. |
| warning `Doc file "x" was not found` | A `doc:` path that does not exist. Paths are relative to the diagram folder. |
| warning `... appears in the story but is in no lane` | A `lanes:` list that leaves out a node the scenario uses. Add it to a lane or ignore: it gets its own lane at the end. |
| warning `Node "x" cites "src/y.ts", which does not exist` | A `refs:` path that moved. Update the diagram or the reference. |

## YAML pitfalls

- **Flow maps and commas.** In `{ label: a, b, kind: x }` the comma ends the value. Quote it: `{ label: "a, b", kind: x }`. Same for a colon followed by a space.
- **Values starting with `{`, `[`, `*`, `&`, `!`, `%`, `@` or a backtick** need quotes.
- **Ports and times** like `:8080` need quotes: `sub: ":8080"`.
- **Indentation** is spaces only, two per level. Steps under `phases:` sit under that phase's `steps:`.
- **Multi-line text** uses `|` and indentation:
  ```yaml
  detail: |
    first line
    second line
  ```
- **`Invalid input: expected string, received undefined`** at a path: a required field is missing there.

## The site

| Symptom | Check |
|---|---|
| `<Diagram name="x"> does not match a diagram` | The folder name differs. The error lists the available names. |
| Build fails with `Diagram errors:` | Run `idocs check`; the build fails on any diagram error by design. |
| The diagram shows "Loading diagram..." and never appears | A browser console error. Is `react()` from `@astrojs/react` in `astro.config.mjs`? |
| Edits to a diagram do not show in dev | Save the file again; if the compiler itself changed (an idocs upgrade), restart the dev server. |
| The page is narrow with a tiny diagram | The Starlight content column. Add `@the-package-labs/idocs-astro/starlight.css` to Starlight's `customCss`. |
| Fonts differ from the screenshots | The templates use IBM Plex via `@fontsource/ibm-plex-sans` and `-mono`; add them or set `--idocs-sans` and `--idocs-mono`. |
| Diagram looks blurry when zoomed | Use the current `@the-package-labs/idocs-react`; older builds kept the zoom layer on the GPU. |
