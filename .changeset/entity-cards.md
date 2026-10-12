---
"@the-package-labs/idocs-core": minor
"@the-package-labs/idocs-react": minor
"@the-package-labs/idocs-astro": minor
"@the-package-labs/idocs": minor
---

Entity cards, for data models. A node with `fields` is drawn as a table of rows, a name on the left and a type on the right: `- id: { type: uuid, key: true }`, `- email: text`, `- customer_id: { type: uuid, ref: customers.id }`. A key gets a `#`, and a field with a `ref` is drawn in the accent colour with an arrow. `pill: TABLE` puts a small label in the card header, `kind: entity` gives the blue table look, and a card with fields is wider by default.

A `ref` draws a `relation` edge between the two cards. Edges can name fields on either end (`orders.customer_id -> customers.id: N:1`), and one you write replaces the one a `ref` would draw, so you can label it. Between two entities an edge is a `relation` by default. The compiler reports an unknown node or field with the nearest match, and the drawer lists a card's fields and the fields each connection is about.

In this release the line runs between the two cards, not to the row.
