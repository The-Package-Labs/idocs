# @the-package-labs/idocs-core

Versions up to 0.2.0 were published as `@packagelab/docspp-core`.

## 0.5.0

### Minor Changes

- 6b984a0: A diagram can say how it opens. A new `defaults:` block takes `view`, `scenario`, `mode` (`flow`, `sequence` or `story`), `sidebar`, `subtitles` and `autoplay`, so every page that shows the diagram opens it the same way, and the props of `<Diagram>` still win over it. The compiler checks that the view and the scenario exist and that the scenario plays on that view. The address bar only records where the reader is when it differs from how the diagram opens.
  
  In the sequence view, the dotted lines now hang from the middle of each node's header, where the arrows begin and end, instead of running between the columns.
- 6b984a0: Entity cards, for data models. A node with `fields` is drawn as a table of rows, a name on the left and a type on the right: `- id: { type: uuid, key: true }`, `- email: text`, `- customer_id: { type: uuid, ref: customers.id }`. A key gets a `#`, and a field with a `ref` is drawn in the accent colour with an arrow. `pill: TABLE` puts a small label in the card header, `kind: entity` gives the blue table look, and a card with fields is wider by default.
  
  A `ref` draws a `relation` edge between the two cards. Edges can name fields on either end (`orders.customer_id -> customers.id: N:1`), and one you write replaces the one a `ref` would draw, so you can label it. Between two entities an edge is a `relation` by default. The compiler reports an unknown node or field with the nearest match, and the drawer lists a card's fields and the fields each connection is about.
  
  In this release the line runs between the two cards, not to the row.
- 6b984a0: Scenarios move to a bar along the bottom of the diagram, like the controls of a video. It has a menu to choose the scenario, the title and description of the step in progress (these replace the subtitles over the picture; `subtitles` and CC now show or hide them), the play buttons, speed and Flow/Sequence/Story, and a slider with a segment for each step, all of the same width, grouped by phase. Pointing at the slider names the step under the pointer. **Steps** opens every step as a list above the bar, with phases that fold, and a description that does not fit ends with **more**, which opens it.
  
  The panel over the picture now holds only the outline and the views, and folds to a single button. It starts open when the diagram has another view to choose, not when it has a scenario. The bar wraps into rows in a narrow widget.
  
  Core exports `buildScrubber`, `positionAt`, `timeAt`, `slotAt` and `slotOfStep`, the model of the slider.

## 0.4.0

### Minor Changes

- 90f07a0: Nested diagrams. A node can name another diagram (`diagram: payments`, or `diagram: { name, view, scenario }`), and its card gets **Expand** and **Open**, and clicking it shows the inner diagram as a picture in the drawer, with the same two as icon buttons. **Expand** shows the whole inner diagram in place as a group (nodes inside can be expanded too), and **Open** moves into that diagram one level deeper with its own views, scenarios and player. `mode` limits it to one, and `expanded: true` starts it expanded. A trail above an opened diagram, a **Back** button and Escape lead back to the parent exactly as it was left, and the way down and what is expanded are part of the shareable link (`#shop~=orders/stock`, `#shop+=orders`).
  
  `idocs check` now also checks across diagrams: a diagram that does not exist, a view or scenario it does not have, and diagrams that open each other in a circle, each at the line that wrote it. `idocs list` shows what opens what. A compiled diagram carries the diagrams it can open, as `nested`, so `<Diagram>` and `DiagramView` need no extra setup; core exports `attachNested`, `nestedDiagrams`, `linkDiagrams` and `layoutNested`.

- `buildOutline` and `outlineNodes` give the hierarchy of a view as a tree (groups, nodes, each node's connections, and the nodes of a diagram shown in place), and `phaseSpans` a scenario's phases as runs of steps, for the outline and the foldable phases of the viewer.

## 0.3.1

### Patch Changes

- The command line is published as `@the-package-labs/idocs`: npm does not accept the unscoped name `idocs`. The command is still `idocs`, so `pnpm idocs check` and the `check` script work as before. Install it with `pnpm add -D @the-package-labs/idocs`.
  
  Projects made with `create-idocs` 0.3.0 depend on a package `idocs` that does not exist and fail to install. Make new projects with 0.3.1 or later, or in such a project replace `"idocs"` in `devDependencies` with `"@the-package-labs/idocs"`.

## 0.3.0

### Minor Changes

- 73fc966: docspp is now **idocs**, and its home is [github.com/The-Package-Labs/idocs](https://github.com/The-Package-Labs/idocs). The diagram format is unchanged; only names change. To move a project over:
  
  - Replace the packages: `@packagelab/docspp-core`, `-react` and `-astro` become `@the-package-labs/idocs-core`, `-react` and `-astro`; the `docspp` CLI becomes `idocs`; `npm create docspp` becomes `npm create idocs`. Update `package.json`, the imports in `astro.config.mjs` and MDX pages, the `/// <reference types="@the-package-labs/idocs-astro/virtual" />` line and any `pnpm docspp` scripts.
  - Rename CSS overrides: the tokens are `--idocs-*` and the classes `.idocs` and `.idocs-*`.
  - Reinstall the agent skill with `npx skills add The-Package-Labs/idocs --skill idocs`; it is now called `idocs`.
  - Run `pnpm idocs schema` to rewrite `diagrams/diagram.schema.json`.

## 0.2.0

### Minor Changes

- aa76c88: Add an `autoplay` prop to `<Diagram>` and `<DiagramView>`. It plays the scenario given by `scenario` as soon as the diagram is laid out, and is ignored when the reader prefers reduced motion. `<Diagram>` also accepts `hash`, which `<DiagramView>` already had: `hash={false}` stops the diagram writing the scenario and step into the page address, which suits decorative embeds.
  
  Fix icons going blank when the same logo appears twice on a page and the first copy is hidden (a tab that is not selected, "Hide planned"). Icon sets reuse gradient ids inside each logo, so the copies shared ids; every instance now has its own.
  
  Fix the playback speed picker keeping the browser's text colour, which made it unreadable when a diagram's palette is dark on a light site (or the other way round).
- f01b737: `DiagramView` gains `onNodeOpen` (called when a node is clicked, without replacing the drawer) and `highlightNode` (outlines a node from outside, for editors that follow the cursor). The browser-safe authoring entry of `@packagelab/docspp-core` now also exports `authoringJsonSchema` and `KNOWN_KEYS`, which the VS Code extension uses for completion.
  
  An "Unknown key" error now points at the unknown key itself instead of the node, group or step that holds it, so `docspp check` and editors underline the right word.
  
  The compiler reports an alias whose anchor does not exist as an error instead of throwing, so `docspp check` no longer crashes on a half-written file. `DiagramView` hides the full-screen button where the page is not allowed to go full screen (such as an iframe without the permission), and ignores a `highlightNode` that is not in the current view.
- 5871024: Add a browser-safe compiler entry with host-provided icons and external node selection hooks for visual editors, powering the documentation site's live YAML playground and visual builder.
