# diagram.yaml reference

One file per diagram: `diagrams/<name>/diagram.yaml`. The folder name is what `<Diagram name="...">` refers to.

```
diagrams/
  diagram.schema.json          editor autocomplete (idocs schema)
  <name>/
    diagram.yaml               the model, views and scenarios
    nodes/<node-id>.md         shown when a reader clicks that node (markdown)
    scenarios/<id>.yaml        optional: a long scenario in its own file; the file name is its id
```

Top-level keys: `title` (required), `description`, `nodes` (required), `groups`, `edges`, `views`, `scenarios`, `kinds`, `edgeKinds`. Unknown keys are errors with a "did you mean" hint.

## Nodes

`nodes:` is a map from id to node. Ids use letters, digits, `_`, `.` and `-`. A bare string is a title: `api: Catalog service`.

| Field | Meaning |
|---|---|
| `title` | Display name. Defaults to the id. |
| `sub` | One mono line under the title: port, stack, version. |
| `lines` | List of short body lines in the card. |
| `icon` | `postgresql` (looks in brand logos, then monochrome brand marks, then Lucide), `logos:redis`, `simple-icons:keycloak`, `lucide:server`, or a path to your own SVG relative to the diagram folder. |
| `kind` | Gives a default icon and colour family (list below). |
| `family` | Accent colour: `blue amber violet green teal red slate`. Overrides the kind's. |
| `in` | Id of the group the node sits in. |
| `status` | `built` (default), `planned`, `legacy`, `optional`. Non-built nodes draw dashed with a tag. |
| `badge` | A number or short string shown on the card corner. |
| `uses` | List of short tags drawn as "uses: a · b". Entries that match a node id become links in the drawer. |
| `chips` | Small boxes inside the card, such as virtual hosts: `- { label: app.*, sub: "→ backend :9100" }`. |
| `w` | Card width in px (default 178). Narrow it in dense rows. |
| `description` | Markdown for the detail drawer, inline. |
| `doc` | Path to a markdown file for the drawer. Defaults to `nodes/<id>.md` when that file exists. |
| `links` | `- { label: Runbook, url: https://... }` |
| `refs` | Source files or URLs the node is based on. `idocs check` warns when a path no longer exists. `src/api.ts`, `src/api.ts:40` and `src/api.ts#L40` all work. |
| `tags` | Free-form tags. |
| `diagram` | Name of another diagram (its folder under `diagrams/`) that shows the inside of this node: `diagram: payments`. The card gets **Expand** (show it in place, as a group around the whole inner diagram) and **Open** (move into it, with a trail and Back button). Clicking the node shows the inner diagram as a picture in the side panel. Long form: `diagram: { name: payments, view: refunds, scenario: pay, mode: both, expanded: false }`. See "Nested diagrams" below. |

Node kinds: `client user ui external service gateway worker container function database cache storage queue agent network vm auth monitor`. Add or override your own with a top-level `kinds:` map: `ledger: { icon: lucide:book-open, family: amber }`.

## Groups

`groups:` is a map from id to group. A top-level group is a filled zone; a group with `in:` is a dashed frame inside another.

| Field | Meaning |
|---|---|
| `label` | Required. Shown in capitals in the zone's corner. |
| `caption` | Muted text after the label: network, runtime, namespace. |
| `in` | Parent group id. |
| `layout` | `flow` (default: automatic), `row` or `grid`: pack members tightly. Use for stores and other cards that need no arrows of their own; arrows to a member end on the group's border. |
| `columns` | Column count for `grid` (and wrapping for `row`). |
| `rows` | Explicit rows of member ids, top to bottom: `rows: [[proxy], [auth, api], [stores]]`. Each row is spread across the group's width. Members must be direct children of the group. |
| `direction` | `AUTO` (default), `RIGHT` or `DOWN`: flow direction inside a top-level group. |
| `family`, `status`, `icon` | As for nodes. |

More on layout choices: [layout.md](layout.md).

## Edges

`edges:` is a list. Forms:

```yaml
edges:
  - browser -> cdn: HTTPS                       # from -> to: label
  - api <-> cache                               # arrows at both ends
  - { from: api, to: db, kind: data, label: SQL, auth: password, payload: queries }
  - { from: api, to: audit, hidden: true }      # not drawn until a scenario uses it
```

| Field | Meaning |
|---|---|
| `from`, `to` | Node ids (required in the object form). |
| `label` | Short: a protocol, route or event name. |
| `kind` | Line style: `http` (default), `channel` (persistent: websocket, gRPC), `tunnel`, `queue`, `ws`, `data`, or one you define in `edgeKinds:`. |
| `both` | Arrow at both ends (same as `<->`). |
| `hidden` | Not drawn and not in the legend, but scenarios can fly along it. Use it for relationships a scenario needs and the picture does not. |
| `status` | As for nodes. |
| `key` | A letter shown on the edge and in the interfaces table. Views with `keys: true` assign them for you. |
| `auth`, `payload`, `transport` | Columns in the interfaces table. |
| `note` | Markdown. |
| `id` | Optional; defaults to its position. |

Custom edge kinds: `edgeKinds: { grpc: { label: gRPC, color: accent, width: 2, dash: "6 4" } }`. `color` is a theme token (`ink accent tunnel muted ok warn bad`) or any CSS colour.

In flow-style `{ ... }` maps, **quote any value that contains a comma or `: `**: `{ label: "device → URL, org", kind: lookup }`.

## Views

Without `views:` there is one view with everything. Add views to show different slices of the same model.

```yaml
views:
  overview:
    title: Overview
    keys: true            # letter keys on edges
    interfaces: true      # table of every edge under the diagram (key, from → to, kind, auth, payload)
    summary: Markdown shown above the diagram.
  backend:
    title: Backend only
    include: [backend, stripe]    # node or group ids; a group includes its members
    exclude: [metrics]
    direction: DOWN               # AUTO (default), RIGHT, DOWN, LEFT, UP
```

Edges whose two ends are both in the view are included. A scenario plays on the first view unless it sets `view:`; every node it uses must be in that view.

## Nested diagrams

A node can hold a whole diagram of its own. Write the inside as an ordinary diagram in its own folder, then point the node at it:

```yaml
# diagrams/shop/diagram.yaml
nodes:
  orders: { kind: service, title: Order service, diagram: orders }
  payments: { kind: service, title: Payments, diagram: { name: payments, scenario: pay } }
```

Readers can **expand** the card, which shows the whole inner diagram in place as a group (and nodes inside can be expanded too), or **open** it, which moves into that diagram with its own views, scenarios and player; **Back**, the trail above it, or Esc return to the parent exactly as they left it. Diagrams can nest as deep as the system does.

- `mode: both` (default), `expand` or `open` limits which of the two the reader gets. `expanded: true` starts the node expanded, so a page shows the whole picture at once.
- An expanded diagram is a preview of one view (the one named, else the first). Its scenarios are played by opening it.

- Nest when the inside of a node is a story of its own. If it only needs a paragraph, use a node doc (`nodes/<id>.md`); if it only needs a different slice of the same model, use a view.
- Several nodes may open the same diagram. A diagram cannot be inside itself: a node that opens its own diagram, or diagrams that open each other in a circle, are errors.
- `idocs check` verifies the name, `view` and `scenario` across diagrams, at the line that wrote them. `idocs list` shows what opens what.
- Nothing else is needed on the page: a compiled diagram carries the diagrams it can open, so `<Diagram name="shop" />` just works.
- Links: `#shop~=orders/stock` opens `orders` then `stock`; `#shop+=orders,orders/stock` has those expanded; each level's scenario is `#shop/orders=create.2`.

## Pages

```mdx
import Diagram from '@the-package-labs/idocs-astro/Diagram.astro'

<Diagram name="shop" />                                  # first view, overview
<Diagram name="shop" view="backend" />
<Diagram name="shop" scenario="checkout" mode="story" />  # mode: flow | sequence | story
<Diagram name="shop" showDescription />                  # the diagram's `description`
```

Other props: `maxHeight` (px, default 780), `showTitle`. Readers can link to a moment with `#<diagram>=<scenario>[.<step>]`, for example `#shop=checkout.3`.

## Theming

Every colour and font is a CSS variable starting `--idocs-` (for example `--idocs-accent`, `--idocs-zone`, `--idocs-sans`, `--idocs-dim` for how faded unrelated items get). Override them under `.idocs` in the site's CSS, and under `:root[data-theme='dark'] .idocs` for dark mode.
