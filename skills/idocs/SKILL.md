---
name: idocs
license: MIT
description: Draw, document and explain systems as interactive architecture diagrams with idocs. Diagrams are YAML files (diagrams/<name>/diagram.yaml) laid out automatically and rendered in an Astro + Starlight docs site, with playable scenarios that show a request travelling through the system. Use when asked to diagram, document or explain a system, service, request path or data flow; to add, change or fix an idocs diagram, scenario or story; when `idocs check` or `pnpm check` reports diagram errors; or to set up an idocs docs site.
---

# idocs

idocs turns a YAML description of a system into an interactive diagram: readers click a box for its docs, hover to follow connections, and press play on a **scenario** to watch a request travel through the system, as packets over the architecture, as a sequence diagram, or as a swimlane story. You write the model. You never write coordinates; layout is automatic.

## 1. Find out where you are

Look at the project before writing anything.

| You see | Do |
|---|---|
| `@the-package-labs/idocs-astro` in `package.json` and a `diagrams/` folder | Authoring. Go to step 2. |
| An Astro or Starlight site without idocs | Add it: [references/setup.md](references/setup.md), "Add idocs to an existing site". |
| No docs site at all | Create one: [references/setup.md](references/setup.md), "Start a new site". |
| The user only wants a picture, with no site | Say that idocs needs a small site to render in, offer to scaffold one, and carry on if they agree. |

Use the project's package manager for every command below (`pnpm idocs ...`, `npx idocs ...`, `yarn idocs ...`). In a project made from the idocs template, `pnpm check` is a shortcut for `idocs check`.

## 2. Authoring workflow

1. **Look at what exists.** `idocs list --json` shows the diagrams, views and scenarios. Extend a diagram rather than starting a second one for the same system.
2. **Read the code you are documenting.** Never invent components, ports, routes or flows. Put the source files a node is based on in its `refs:` so readers can find them and `idocs check` warns when they move.
3. **Pick a scope.** One diagram answers one question ("how does checkout work?"). Aim for 8 to 25 nodes. If it needs more, make a second **view** of the same model. If one node has an inside worth a diagram of its own, give it `diagram: <name>` ("Nested diagrams" in [references/format.md](references/format.md)) instead of crowding the parent.
4. **Write the model**: nodes, then groups, then edges. Declare nodes in reading order: order decides layout. Format: [references/format.md](references/format.md).
5. **Add scenarios** for the flows a reader will ask about: the happy path first, then the failures that teach something. Format and writing advice: [references/scenarios.md](references/scenarios.md).
6. **Check.** `idocs check --json`. Fix every error and every warning; messages carry `file:line:column` and a suggestion. Common ones: [references/troubleshooting.md](references/troubleshooting.md).
7. **Put it on a page and look at it.** Add `<Diagram name="<name>" />` to an `.mdx` page (see below), run the dev server, and view the page with a browser tool if you have one. A diagram that validates can still look wrong; fix layout with hints: [references/layout.md](references/layout.md).

If you are not sure what a finished diagram looks like, read [assets/examples/shop.diagram.yaml](assets/examples/shop.diagram.yaml). It is complete and is checked by tests.

## The format at a glance

```yaml
# yaml-language-server: $schema=../diagram.schema.json
title: Online store checkout
description: How a shopper's request travels.        # markdown, shown above the diagram

groups:
  backend: { label: Backend, caption: Kubernetes }

nodes:
  browser: { kind: client, icon: react, title: Shopper browser }
  api:
    kind: service                 # default icon and colour (list in references/format.md)
    icon: nodejs                  # a name, logos:x, lucide:x, or ./file.svg
    title: catalog-service
    sub: ":4001 · Node.js"        # mono line under the title
    status: planned               # built (default) | planned | legacy | optional
    in: backend
    refs: [services/catalog/server.ts]
  db: { kind: database, icon: postgresql, title: PostgreSQL, in: backend }

edges:
  - browser -> api: HTTPS         # shorthand: from -> to: label
  - { from: api, to: db, kind: data, label: SQL, auth: password }

scenarios:
  browse:
    title: Browse a product
    steps:
      - browser -> api: GET /products/42     # flies along the edges, hop by hop
      - api -> db: { label: SELECT, kind: lookup }
      - db -> api: rows                       # flying against an edge makes it a response
      - api -> browser: 200 OK
```

Click-through documentation for a box goes in `diagrams/<name>/nodes/<id>.md` (markdown, tables and code fences work). Every code fence gets a Copy button, and in a shell, text or config fence a `{name}` or `<name>` is a value the reader fills in before copying (`\{name}` writes the braces literally; `vars` and `novars` after the language turn it on or off for other languages). Long scenarios can live in `diagrams/<name>/scenarios/<id>.yaml`.

On a page (`src/content/docs/*.mdx`):

```mdx
import Diagram from '@the-package-labs/idocs-astro/Diagram.astro'

<Diagram name="shop" />
<Diagram name="shop" scenario="browse" mode="story" />
```

## Conventions that make diagrams good

- **Titles are the names people use in conversation.** `sub` carries the technical detail: port, stack, version.
- **Edge labels are short**: a protocol, a route, an event name. Detail goes in `payload:` and `auth:`.
- **Mark unbuilt work `status: planned`**, never only in prose. It draws dashed and readers can hide it.
- **One story per scenario.** Show failure paths as their own scenarios (`payment-declined`), not as footnotes.
- **Steps: one verb each**, label what travels (`POST /orders`, `order.created`), explain why in `note:`. Group into two to five phases with plain titles ("Submit", "Charge", "Finish").
- **Do not restate the diagram in prose on the page.** Use the page for what the diagram cannot say: why a choice was made, what to watch for, who to ask.

## Commands

| Command | What it does |
|---|---|
| `idocs check [root...] [--json] [--strict]` | Validate every diagram. `--strict` also fails on warnings. |
| `idocs list [--json]` | Diagrams, views, scenarios. |
| `idocs icons search <query>` | Find an icon name (`postgresql`, `logos:redis`, `lucide:server`). |
| `idocs new <name>` | Scaffold `diagrams/<name>/`. |
| `idocs schema` | Write `diagrams/diagram.schema.json` so editors autocomplete and validate the YAML. |

## Before you say you are done

- [ ] `idocs check --strict` passes with no errors or warnings.
- [ ] Every node and flow comes from the code or from the user, not from a guess.
- [ ] The page renders and the diagram is readable at its default zoom. If it is tiny, it has too much in it.
- [ ] Planned work is marked `status: planned`.
- [ ] Each scenario tells one story and has a one-sentence `summary`.
