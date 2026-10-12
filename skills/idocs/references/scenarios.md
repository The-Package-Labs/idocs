# Scenarios

A scenario is a story that plays over a diagram: an ordered list of steps. Each step flies a packet along your edges, or makes one node do something. A diagram can have any number of scenarios; readers pick one above the diagram.

## Shape

```yaml
scenarios:
  place-order:
    title: Place an order
    summary: |                      # the story in one or two sentences (markdown)
      The order is saved first, charged second and confirmed last.
    phases:                         # optional chapters; or use a flat `steps:` list
      - title: Save
        caption: before any money moves
        steps:
          - browser -> orders:
              label: POST /orders
              note: The request carries an idempotency key.     # explanation shown in the timeline
          - orders -> db: { label: INSERT order, kind: lookup }
      - title: Charge
        steps:
          - orders -> stripe: create payment intent
          - at stripe: { label: authorise card, note: The one step we do not control. }
          - stripe -> orders: succeeded
```

Only `title` and at least one step are required. Other scenario fields: `view` (which view to play on; default the first), `mode` (`flow`, `sequence` or `story`: how it opens), `lanes` (story columns, below).

## Steps

| You write | What happens |
|---|---|
| `a -> b: label` | A packet flies from `a` to `b`. |
| `at a: label` | `a` pulses and shows the caption: "this component does something". |
| `par:` with a nested list | The steps inside start together. |

Every step can be written compactly (`a -> b: label`) or as a map (`a -> b: { label: ..., kind: ..., note: ... }`). Options:

| Option | Meaning |
|---|---|
| `label` | What travels, shown on the packet. Keep it short. |
| `kind` | `request` (default), `response`, `error`, `lookup`, `event`. Changes the packet's colour and style. |
| `note` | Markdown explanation shown in the timeline. |
| `status` | `planned` draws the step dashed with a tag. |
| `via` | Force the route through these nodes: `via: [gateway]`. |
| `hold` | Extra pause in seconds. |
| `title`, `detail` | The heading and short body of the step's box in the story view. |

**Routing.** Steps follow the edges you declared. If `a` and `b` are not directly connected, the packet takes the shortest route through the nodes between them, hop by hop (`browser -> db` flies through the API). If there is no route, `idocs check` says so: declare an edge (it can be `hidden: true`) or add `via`.

**Responses.** A packet that flies against an edge's direction is a response automatically (green), so `db -> api` over an `api -> db` edge needs no `kind`. Write `kind: error` for failures.

**Lookups.** `kind: lookup` marks a quick question to a data store or cache. Follow it with the answer: `cache -> api: hit`.

## Story view

The same scenario can be read as a story: swimlanes with one column per actor, steps running down the page in order, and the phases as bands. Readers switch with the Flow / Sequence / Story buttons; `mode: story` makes it the default.

How steps become boxes:

| Step | In the story |
|---|---|
| `at a: ...` | A box in `a`'s lane. |
| `a -> b: ...` | A box in `b`'s lane, joined by an arrow to the box before it. If the story is not already at `a`, a small box shows where it starts. |
| `a -> b: { kind: lookup }` | A dashed box in `b`'s lane, level with the step that asked, joined by a double-headed dotted arrow. The answer step that follows is folded into the same box. |

Boxes are numbered 1, 2, 3 along the story; lookups are not numbered. Click a box to play that step.

```yaml
scenarios:
  read-request:
    title: One read request, end to end
    mode: story
    lanes:                                # columns, left to right
      - { title: Browser, nodes: [browser] }
      - { title: Stores, sub: Redis · Postgres, nodes: [redis, postgres] }    # one lane, several nodes
    phases:
      - title: Who are you?
        steps:
          - gateway -> backend:
              title: Check the session    # box heading; defaults to the label
              detail: |                   # one to three short lines; defaults to "from → to"
                cookie → session
                token read from Redis
          - backend -> redis: { label: session lookup, kind: lookup }
          - redis -> backend: found
          - at backend: { title: Which device?, detail: id → URL + org }
```

- Without `lanes` you get one lane per node, in order of first appearance. With `lanes`, list them in the order you want; nodes you leave out get their own lane at the end, and `idocs check` warns about them.
- Write `title` as a short question or verb phrase ("Who are you?", "Cross the tunnel") and `detail` as what is concrete: a route, a header, a store. They are for the story only; the packet label stays short.
- Use `at` steps for "this component does something" moments, and lookups for questions to a data store.
- Keep a story to about 8 lanes and 15 boxes. Past that, split it into two scenarios.

## Writing good scenarios

- **One question per scenario.** "Pay with a card" and "Card declined" are two scenarios.
- **Failures get their own scenario.** That is where readers learn the most.
- **Label what travels** (`POST /payments`, `payment.succeeded`) and put the reasoning in `note`.
- **Two to five phases**, with plain names. They become the chapter headings in the timeline.
- **Do not narrate the obvious.** A note should answer "why" or "what could go wrong here".
- **Start at the actor.** The first step is usually `browser -> gateway`, or an `at` step describing the trigger.
- If a scenario needs a relationship you do not want drawn, add the edge with `hidden: true`.
