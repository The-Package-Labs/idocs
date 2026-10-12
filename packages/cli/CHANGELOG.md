# @the-package-labs/idocs

Versions up to 0.2.0 were published as `docspp`.

## 0.4.0

### Minor Changes

- 90f07a0: Nested diagrams. A node can name another diagram (`diagram: payments`, or `diagram: { name, view, scenario }`), and its card gets **Expand** and **Open**, and clicking it shows the inner diagram as a picture in the drawer, with the same two as icon buttons. **Expand** shows the whole inner diagram in place as a group (nodes inside can be expanded too), and **Open** moves into that diagram one level deeper with its own views, scenarios and player. `mode` limits it to one, and `expanded: true` starts it expanded. A trail above an opened diagram, a **Back** button and Escape lead back to the parent exactly as it was left, and the way down and what is expanded are part of the shareable link (`#shop~=orders/stock`, `#shop+=orders`).
  
  `idocs check` now also checks across diagrams: a diagram that does not exist, a view or scenario it does not have, and diagrams that open each other in a circle, each at the line that wrote it. `idocs list` shows what opens what. A compiled diagram carries the diagrams it can open, as `nested`, so `<Diagram>` and `DiagramView` need no extra setup; core exports `attachNested`, `nestedDiagrams` and `linkDiagrams`.

### Patch Changes

- Updated dependencies [90f07a0]
  - @the-package-labs/idocs-core@0.4.0

## 0.3.1

### Patch Changes

- The command line is published as `@the-package-labs/idocs`: npm does not accept the unscoped name `idocs`. The command is still `idocs`, so `pnpm idocs check` and the `check` script work as before. Install it with `pnpm add -D @the-package-labs/idocs`.
  
  Projects made with `create-idocs` 0.3.0 depend on a package `idocs` that does not exist and fail to install. Make new projects with 0.3.1 or later, or in such a project replace `"idocs"` in `devDependencies` with `"@the-package-labs/idocs"`.
- Updated dependencies
  - @the-package-labs/idocs-core@0.3.1

## 0.3.0

Not published: npm refused the name `idocs`. See 0.3.1.

### Minor Changes

- 73fc966: docspp is now **idocs**, and its home is [github.com/The-Package-Labs/idocs](https://github.com/The-Package-Labs/idocs). The diagram format is unchanged; only names change. To move a project over:
  
  - Replace the packages: `@packagelab/docspp-core`, `-react` and `-astro` become `@the-package-labs/idocs-core`, `-react` and `-astro`; the `docspp` CLI becomes `idocs`; `npm create docspp` becomes `npm create idocs`. Update `package.json`, the imports in `astro.config.mjs` and MDX pages, the `/// <reference types="@the-package-labs/idocs-astro/virtual" />` line and any `pnpm docspp` scripts.
  - Rename CSS overrides: the tokens are `--idocs-*` and the classes `.idocs` and `.idocs-*`.
  - Reinstall the agent skill with `npx skills add The-Package-Labs/idocs --skill idocs`; it is now called `idocs`.
  - Run `pnpm idocs schema` to rewrite `diagrams/diagram.schema.json`.

### Patch Changes

- Updated dependencies [73fc966]
  - @the-package-labs/idocs-core@0.3.0

## 0.2.0

### Minor Changes

- aa76c88: Add an `autoplay` prop to `<Diagram>` and `<DiagramView>`. It plays the scenario given by `scenario` as soon as the diagram is laid out, and is ignored when the reader prefers reduced motion. `<Diagram>` also accepts `hash`, which `<DiagramView>` already had: `hash={false}` stops the diagram writing the scenario and step into the page address, which suits decorative embeds.
  
  Fix icons going blank when the same logo appears twice on a page and the first copy is hidden (a tab that is not selected, "Hide planned"). Icon sets reuse gradient ids inside each logo, so the copies shared ids; every instance now has its own.
  
  Fix the playback speed picker keeping the browser's text colour, which made it unreadable when a diagram's palette is dark on a light site (or the other way round).

### Patch Changes

- Updated dependencies [aa76c88]
- Updated dependencies [f01b737]
- Updated dependencies [5871024]
  - @packagelab/docspp-core@0.2.0
