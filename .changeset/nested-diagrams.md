---
"@the-package-labs/idocs-core": minor
"@the-package-labs/idocs-react": minor
"@the-package-labs/idocs-astro": minor
"@the-package-labs/idocs": minor
---

Nested diagrams. A node can name another diagram (`diagram: payments`, or `diagram: { name, view, scenario }`), and its card gets a **Look inside** strip that opens that diagram one level deeper, with its own views, scenarios and player. A trail above it, a **Back** button and Escape lead back to the parent exactly as it was left, and the way down is part of the shareable link (`#shop~=orders/stock`).

`idocs check` now also checks across diagrams: a diagram that does not exist, a view or scenario it does not have, and diagrams that open each other in a circle, each at the line that wrote it. `idocs list` shows what opens what. `<Diagram>` sends the page the diagrams it can reach; `DiagramView` takes them as `diagrams`, and core exports `nestedDiagrams` and `linkDiagrams`.
