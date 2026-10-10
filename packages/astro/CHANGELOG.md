# @the-package-labs/idocs-astro

Versions up to 0.2.0 were published as `@packagelab/docspp-astro`.

## 0.3.1

### Patch Changes

- The command line is published as `@the-package-labs/idocs`: npm does not accept the unscoped name `idocs`. The command is still `idocs`, so `pnpm idocs check` and the `check` script work as before. Install it with `pnpm add -D @the-package-labs/idocs`.
  
  Projects made with `create-idocs` 0.3.0 depend on a package `idocs` that does not exist and fail to install. Make new projects with 0.3.1 or later, or in such a project replace `"idocs"` in `devDependencies` with `"@the-package-labs/idocs"`.
- Updated dependencies
  - @the-package-labs/idocs-core@0.3.1
  - @the-package-labs/idocs-react@0.3.1

## 0.3.0

### Minor Changes

- 73fc966: docspp is now **idocs**, and its home is [github.com/The-Package-Labs/idocs](https://github.com/The-Package-Labs/idocs). The diagram format is unchanged; only names change. To move a project over:
  
  - Replace the packages: `@packagelab/docspp-core`, `-react` and `-astro` become `@the-package-labs/idocs-core`, `-react` and `-astro`; the `docspp` CLI becomes `idocs`; `npm create docspp` becomes `npm create idocs`. Update `package.json`, the imports in `astro.config.mjs` and MDX pages, the `/// <reference types="@the-package-labs/idocs-astro/virtual" />` line and any `pnpm docspp` scripts.
  - Rename CSS overrides: the tokens are `--idocs-*` and the classes `.idocs` and `.idocs-*`.
  - Reinstall the agent skill with `npx skills add The-Package-Labs/idocs --skill idocs`; it is now called `idocs`.
  - Run `pnpm idocs schema` to rewrite `diagrams/diagram.schema.json`.

### Patch Changes

- Updated dependencies [73fc966]
  - @the-package-labs/idocs-core@0.3.0
  - @the-package-labs/idocs-react@0.3.0

## 0.2.0

### Minor Changes

- aa76c88: Add an `autoplay` prop to `<Diagram>` and `<DiagramView>`. It plays the scenario given by `scenario` as soon as the diagram is laid out, and is ignored when the reader prefers reduced motion. `<Diagram>` also accepts `hash`, which `<DiagramView>` already had: `hash={false}` stops the diagram writing the scenario and step into the page address, which suits decorative embeds.
  
  Fix icons going blank when the same logo appears twice on a page and the first copy is hidden (a tab that is not selected, "Hide planned"). Icon sets reuse gradient ids inside each logo, so the copies shared ids; every instance now has its own.
  
  Fix the playback speed picker keeping the browser's text colour, which made it unreadable when a diagram's palette is dark on a light site (or the other way round).

### Patch Changes

- eae176e: Fix `astro dev` not rendering diagrams in a project made with `npm create docspp`. The integration asked Vite to pre-bundle `elkjs` through `@packagelab/docspp-core`, which a project that does not list that package itself (the starter, under pnpm) cannot see, so Vite found the layout library only after the page loaded and reloaded in the middle of hydration. Every pre-bundled entry is now reached through `@packagelab/docspp-astro`, and `d3-transition` is pre-bundled as well. If you added a workaround to `vite.optimizeDeps` in `astro.config.mjs`, you can remove it.
- Updated dependencies [aa76c88]
- Updated dependencies [f01b737]
- Updated dependencies [5871024]
  - @packagelab/docspp-react@0.2.0
  - @packagelab/docspp-core@0.2.0
