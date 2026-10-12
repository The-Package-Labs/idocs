---
"@the-package-labs/idocs-core": minor
"@the-package-labs/idocs-react": minor
"@the-package-labs/idocs-astro": minor
"@the-package-labs/idocs": minor
---

A diagram can say how it opens. A new `defaults:` block takes `view`, `scenario`, `mode` (`flow`, `sequence` or `story`), `sidebar`, `subtitles` and `autoplay`, so every page that shows the diagram opens it the same way, and the props of `<Diagram>` still win over it. The compiler checks that the view and the scenario exist and that the scenario plays on that view. The address bar only records where the reader is when it differs from how the diagram opens.

In the sequence view, the dotted lines now hang from the middle of each node's header, where the arrows begin and end, instead of running between the columns.
