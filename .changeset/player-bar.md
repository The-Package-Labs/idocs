---
"@the-package-labs/idocs-core": minor
"@the-package-labs/idocs-react": minor
"@the-package-labs/idocs-astro": minor
"@the-package-labs/idocs": minor
---

Scenarios move to a bar along the bottom of the diagram, like the controls of a video. It has a menu to choose the scenario, the title and description of the step in progress (these replace the subtitles over the picture; `subtitles` and CC now show or hide them), the play buttons, speed and Flow/Sequence/Story, and a slider with a segment for each step, all of the same width, grouped by phase. Pointing at the slider names the step under the pointer. **Steps** opens every step as a list above the bar, with phases that fold, and a description that does not fit ends with **more**, which opens it.

The panel over the picture now holds only the outline and the views, and folds to a single button. It starts open when the diagram has another view to choose, not when it has a scenario. The bar wraps into rows in a narrow widget.

Core exports `buildScrubber`, `positionAt`, `timeAt`, `slotAt` and `slotOfStep`, the model of the slider.
