# Plan and decisions

What this repository is: a **template** for documentation sites in which architecture diagrams are written as YAML, laid out automatically, and can be *played*: pick a scenario and a request flies through the diagram, step by step.

## What v1 contains

| Area | Shipped |
|---|---|
| Format | `diagrams/<name>/diagram.yaml`: nodes, groups, edges, views, scenarios, custom kinds and edge kinds. Shorthand for edges (`a -> b: label`) and steps (`a -> b: label`, `at a: label`, `par:`). Node docs from `nodes/<id>.md`; long scenarios from `scenarios/<id>.yaml`. JSON Schema for editors. |
| Compiler | YAML to a validated, JSON-serialisable model. Errors carry `file:line:col` and "did you mean" hints. Icons resolved at build time. Markdown rendered at build time (raw HTML dropped). |
| Layout | Group by group, bottom up. ELK for flow groups, author-written `rows`, tightly packed `row` / `grid`, an obstacle-avoiding orthogonal router for edges that cross zones, automatic RIGHT/DOWN choice. |
| Renderer | Pan/zoom (Ctrl/⌘ + scroll, drag), fit, fullscreen. Cards with icons, status, chips, badges. Zones and frames. Edge kinds with a generated legend, letter keys, hover focus, planned-item toggle. Detail drawer. Interfaces table generated from the model. Light and dark. |
| Scenarios | Several per diagram. Phases, self steps, parallel steps, automatic multi-hop routing, request/response/error/lookup/event packets, notes, hidden edges. Player: play, pause, previous/next step, scrub, speed. Flow, sequence or swimlane-story presentation (`story.ts`: lanes, phase bands, lookups folded into side boxes). Follow-the-action camera. Deep links (`#checkout=place-order.4`). |
| Site | Astro + Starlight, `<Diagram name="..." />`, GitHub Pages workflow, CI. |
| Tooling | `idocs check/list/schema/icons/new`, stale `refs:` warnings, the `idocs` agent skill (installable with `npx skills add`). |
| Distribution | Five publishable packages built to `dist/`, `create-idocs` scaffolder, a minimal `templates/starter`, changesets, release and template-sync workflows (both off until opted in), and `pnpm verify:pack`, which installs the packed packages like a user would. See [REPOSITORIES.md](REPOSITORIES.md). |
| Tests | Unit tests for compiler, layout invariants, router, timeline, CLI. End-to-end tests in real Chrome (`pnpm test:e2e`). |

## Decisions

**Own renderer on d3-zoom, not React Flow.** The first plan used React Flow. Once ELK computes every position and every edge route, React Flow's node/handle/edge model would be bypassed; what remained was pan and zoom, which `d3-zoom` does in a few lines. Owning the layers also makes the packet overlay, the dimming during playback and the camera follow straightforward.

**YAML, not a custom DSL.** A DSL costs a parser and a language server. YAML plus a JSON Schema gives editor autocomplete, and is easy for people and for agents to write. Shorthand covers the common cases.

**Model, views, scenarios.** A node is written once. Views choose subsets; scenarios play over a view. This is what keeps a large system maintainable.

**Layout by group, not one ELK run.** A single run over the whole hierarchy forces one direction on every zone; a platform-style diagram came out about three times too wide (3500px against 1800px). Laying out each zone separately and arranging the zones afterwards fixed that, at the price of routing cross-zone edges ourselves (`route.ts`). `rows:` exists because explicit rows are how people draw stacks (gateway, services, stores) and ELK cannot do that on its own.

**Layout hints, never coordinates.** Declaration order, `rows`, `layout: row|grid`, `direction`, `w`. If a diagram needs more than that, the model is probably too big for one picture.

**The timeline is data.** A scenario compiles to a timeline; `frameAt(t)` is a pure function. The player is a clock. Scrubbing, stepping, deep links and tests all fall out of that.

**Compile and validate at build time.** The build fails on a broken diagram. The client receives plain JSON.

**Generic example, not a real one.** `apps/docs/diagrams/platform` copies the *structure* of a real platform architecture page (zones, hub and spoke tunnel, grids, planned parts) with invented names, so the template is safe to publish.

## Known limits

- Auto layout is good, not perfect. Dense diagrams want a few hints; very large ones (30+ nodes) render small until the reader zooms, goes full screen, or lets the camera follow a scenario.
- Edges that end on a member of a `row` or `grid` group stop at the group's border.
- `astro check` does not support TypeScript 7 yet, so `.astro` files are not type-checked; TS files in the docs app are.
- ELK runs on the main thread. The diagram chunk is about 460 KB gzipped, nearly all ELK, and only loads when a diagram scrolls into view. A worker would remove the layout pause on very large diagrams, and build-time layout would remove ELK from the client entirely.
- Node heights are measured in the browser, so first paint of a diagram shows a placeholder.

## Next

1. **Automate releases.** The first publish (0.1.0) was done from a laptop. For later releases set `NPM_TOKEN` and `RELEASE_ENABLED` so the Release workflow opens "Version packages" pull requests, as described in [REPOSITORIES.md](REPOSITORIES.md). Optionally set up the generated template repository.
2. **More view types**: state diagrams. Entity cards are done (fields, `ref`, `node.field` edges); relation lines that end on the field's row are next. The format reserves `type:` on views. (The swimlane "request story" is done: it is a presentation of a scenario, not a view type.)
3. **Forked scenarios**: "device offline at step 6" as a variant that shares the happy path up to a step.
4. **Visual regression**: Playwright screenshots of the examples in both themes.
5. **Export**: SVG, PNG and GIF of a scenario for READMEs and slides.
6. **ELK in a worker**, and build-time layout for diagrams that do not depend on measured text.
7. **Imports**: Mermaid, OpenAPI.
8. **An MCP server** exposing `check`, `list` and `icons` so agents do not need a shell.
