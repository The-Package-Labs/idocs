import { z } from 'zod'

const Id = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+$/, 'ids may only contain letters, digits, "_", "." and "-"')

export const StatusSchema = z.enum(['built', 'planned', 'legacy', 'optional'])
export const FamilySchema = z.enum(['blue', 'amber', 'violet', 'green', 'teal', 'red', 'slate'])
export const StepKindSchema = z.enum(['request', 'response', 'error', 'lookup', 'event'])
export const DirectionSchema = z.enum(['AUTO', 'RIGHT', 'DOWN', 'LEFT', 'UP'])

const ChipSchema = z.union([
  z.string(),
  z.strictObject({ label: z.string(), sub: z.string().optional() }),
])

const FieldProps = z.strictObject({
  type: z.string().optional().describe('Its type: `keyword`, `uuid`, `string[]`.'),
  key: z.boolean().optional().describe('Part of the primary key. Shown with a `#` in front.'),
  ref: z
    .string()
    .optional()
    .describe(
      'The `node` or `node.field` this one points at, like a foreign key. Draws a relation between the two cards.',
    ),
  note: z.string().optional().describe('Shown on hover and in the drawer.'),
})

/** One field per list item: `- name`, `- name: type` or `- name: { type, key, ref, note }`. */
const FieldSchema = z.union([
  z.string().min(1),
  z
    .record(z.string().min(1), z.union([z.string(), z.null(), FieldProps]))
    .refine((o) => Object.keys(o).length === 1, {
      message: 'One field per list item: `- name: type`',
    }),
])

export const NodeSchema = z.strictObject({
  title: z.string().optional().describe('Display name. Defaults to the node id.'),
  sub: z
    .string()
    .optional()
    .describe('One line under the title, rendered in mono (ports, stack, version).'),
  pill: z
    .string()
    .optional()
    .describe('Short label in the card header, like `TABLE` or `ES INDEX`.'),
  lines: z.array(z.string()).optional().describe('Short body lines inside the card.'),
  fields: z
    .array(FieldSchema)
    .optional()
    .describe(
      'Makes the card an entity: a table of fields, each `name: type`. `ref` points a field at another entity.',
    ),
  icon: z
    .string()
    .optional()
    .describe('`postgresql`, `logos:redis`, `lucide:server` or ./path/to.svg.'),
  kind: z.string().optional().describe('Gives a default icon and colour family. See `kinds`.'),
  family: FamilySchema.optional().describe('Accent colour family; overrides the kind default.'),
  in: Id.optional().describe('Id of the group this node belongs to.'),
  status: StatusSchema.optional(),
  badge: z.union([z.string(), z.number()]).optional().describe('Numbered marker on the card.'),
  uses: z.array(z.string()).optional().describe('Small "uses: a · b" tag line.'),
  chips: z
    .array(ChipSchema)
    .optional()
    .describe('Small boxes inside the card, e.g. virtual hosts.'),
  w: z.number().int().positive().optional().describe('Card width in px (default 178).'),
  description: z.string().optional().describe('Markdown shown in the detail drawer.'),
  doc: z
    .string()
    .optional()
    .describe('Markdown file for the drawer. Defaults to nodes/<id>.md when present.'),
  links: z.array(z.strictObject({ label: z.string(), url: z.string() })).optional(),
  refs: z.array(z.string()).optional().describe('Source files or URLs this node is based on.'),
  tags: z.array(z.string()).optional(),
  diagram: z
    .union([
      z.string().min(1),
      z.strictObject({
        name: z.string().min(1).describe('Folder name of the diagram, under diagrams/.'),
        view: Id.optional().describe(
          'View to open first. Defaults to the scenario view, then the first.',
        ),
        scenario: Id.optional().describe('Scenario to select when the diagram opens.'),
        mode: z
          .enum(['both', 'expand', 'open'])
          .optional()
          .describe(
            'both (default): the reader can expand it in place or open it. expand: only in place. open: only move into it.',
          ),
        expanded: z
          .boolean()
          .optional()
          .describe('Start expanded in place, so the whole inner diagram shows as a group.'),
      }),
    ])
    .optional()
    .describe(
      'Another diagram (its folder name) that shows the inside of this node. The card gets buttons to expand it in place, as a group, or to open it one level deeper, with a way back.',
    ),
})

export const GroupSchema = z.strictObject({
  label: z.string(),
  caption: z.string().optional().describe('Muted text after the label (network, runtime).'),
  in: Id.optional().describe('Id of the parent group.'),
  rows: z
    .array(z.array(Id))
    .optional()
    .describe(
      'Explicit rows of member ids, top to bottom. Each row is spread across the group width.',
    ),
  layout: z
    .enum(['flow', 'row', 'grid'])
    .optional()
    .describe(
      'flow: auto layout (default). row/grid: pack members tightly (for stores and other edge-less cards).',
    ),
  columns: z.number().int().positive().optional(),
  direction: z
    .enum(['AUTO', 'RIGHT', 'DOWN'])
    .optional()
    .describe('Flow direction inside a top-level group. AUTO (default) picks the squarer result.'),
  family: FamilySchema.optional(),
  status: StatusSchema.optional(),
  icon: z.string().optional(),
})

export const EdgeSchema = z.strictObject({
  id: Id.optional(),
  from: Id,
  to: Id,
  label: z.string().optional(),
  kind: z
    .string()
    .optional()
    .describe('http (default), channel, tunnel, queue, ws, data, or a custom edgeKind.'),
  both: z.boolean().optional().describe('Arrow at both ends.'),
  hidden: z
    .boolean()
    .optional()
    .describe(
      'Not drawn until a scenario uses it. Lets scenarios cross relationships you would rather not clutter the diagram with.',
    ),
  status: StatusSchema.optional(),
  key: z.string().optional().describe('Letter shown on the edge and in the interfaces table.'),
  auth: z.string().optional(),
  payload: z.string().optional().describe('What travels over this edge.'),
  transport: z.string().optional(),
  note: z.string().optional().describe('Markdown.'),
})

export const ViewSchema = z.strictObject({
  title: z.string().optional(),
  summary: z.string().optional().describe('Markdown shown above the diagram.'),
  include: z
    .union([z.literal('all'), z.array(Id)])
    .optional()
    .describe('Node or group ids. Groups include their members.'),
  exclude: z.array(Id).optional(),
  direction: DirectionSchema.optional().describe(
    'Main flow direction. AUTO (default) tries RIGHT and DOWN and keeps the one that reads larger.',
  ),
  keys: z.boolean().optional().describe('Assign letter keys (A, B, ...) to edges.'),
  interfaces: z.boolean().optional().describe('Show the interfaces table under the diagram.'),
})

const stepCommon = {
  title: z
    .string()
    .optional()
    .describe('Heading of the step in the story view. Defaults to the label.'),
  detail: z
    .string()
    .optional()
    .describe(
      'One to three short lines under the heading in the story view. Defaults to "from → to".',
    ),
  kind: StepKindSchema.optional(),
  note: z.string().optional().describe('Markdown explanation shown with the step.'),
  status: StatusSchema.optional(),
  hold: z.number().min(0).optional().describe('Extra pause in seconds.'),
}

const FlowStepSchema = z.strictObject({
  type: z.literal('flow'),
  from: Id,
  to: Id,
  label: z.string().optional(),
  via: z.array(Id).optional().describe('Force the route through these nodes.'),
  ...stepCommon,
})

const SelfStepSchema = z.strictObject({
  type: z.literal('self'),
  at: Id,
  label: z.string().optional().describe('Caption shown on the node. Defaults to the title.'),
  ...stepCommon,
})

const ParStepSchema = z.strictObject({
  type: z.literal('par'),
  steps: z.array(z.discriminatedUnion('type', [FlowStepSchema, SelfStepSchema])).min(1),
})

export const StepSchema = z.discriminatedUnion('type', [
  FlowStepSchema,
  SelfStepSchema,
  ParStepSchema,
])

const PhaseSchema = z.strictObject({
  title: z.string(),
  caption: z.string().optional(),
  steps: z.array(StepSchema).min(1),
})

const LaneSchema = z.strictObject({
  title: z.string(),
  sub: z
    .string()
    .optional()
    .describe('Under the title. Defaults to the node subtitle, or the node titles joined.'),
  nodes: z.array(Id).min(1).describe('Nodes shown in this lane.'),
})

const ScenarioBase = z.strictObject({
  title: z.string(),
  mode: z
    .enum(['flow', 'sequence', 'story'])
    .optional()
    .describe(
      'How the scenario opens: packets over the diagram, a sequence diagram, or a swimlane story.',
    ),
  lanes: z
    .array(LaneSchema)
    .optional()
    .describe(
      'Columns of the story view, left to right. Nodes you leave out get a lane of their own at the end.',
    ),
  summary: z.string().optional().describe('Markdown: the story in a few sentences.'),
  view: Id.optional().describe('View to play on. Defaults to the first view.'),
  phases: z.array(PhaseSchema).optional(),
  steps: z.array(StepSchema).optional(),
})

export const ScenarioSchema = ScenarioBase.refine(
  (s) => (s.phases?.length ?? 0) + (s.steps?.length ?? 0) > 0,
  { message: 'A scenario needs `steps` or `phases`' },
)

export const DefaultsSchema = z.strictObject({
  view: Id.optional().describe(
    'View shown first. Defaults to the view of `scenario`, or else the first view.',
  ),
  scenario: Id.optional().describe(
    'Scenario selected first. Without it the diagram opens on its overview. It does not play until a reader presses play, unless `autoplay` is on.',
  ),
  mode: z
    .enum(['flow', 'sequence', 'story'])
    .optional()
    .describe(
      'How a scenario is drawn when it has no `mode` of its own: packets over the diagram, a sequence diagram, or a swimlane story.',
    ),
  sidebar: z
    .boolean()
    .optional()
    .describe(
      'Whether the panel over the picture starts open. By default it does when there is a scenario or another view to choose, and the frame is wide enough.',
    ),
  subtitles: z
    .boolean()
    .optional()
    .describe('Words over the picture saying what the scenario is doing. On by default.'),
  autoplay: z
    .boolean()
    .optional()
    .describe(
      'Play `scenario` as soon as the diagram is on screen. Needs `scenario`, and is ignored when the system asks for reduced motion.',
    ),
})

export const RootSchema = z.strictObject({
  $schema: z.string().optional(),
  title: z.string(),
  description: z.string().optional().describe('Markdown shown above the first view.'),
  defaults: DefaultsSchema.optional().describe(
    'How the diagram opens: its view, scenario and mode, and whether the panel and subtitles show. A page can still choose otherwise with the props of `<Diagram>`.',
  ),
  kinds: z
    .record(Id, z.strictObject({ icon: z.string().optional(), family: FamilySchema.optional() }))
    .optional(),
  edgeKinds: z
    .record(
      Id,
      z.strictObject({
        label: z.string(),
        color: z.string().optional(),
        width: z.number().positive().optional(),
        dash: z.string().optional(),
      }),
    )
    .optional(),
  groups: z.record(Id, GroupSchema).optional(),
  nodes: z.record(Id, NodeSchema),
  edges: z.array(EdgeSchema).optional(),
  views: z.record(Id, ViewSchema).optional(),
  scenarios: z.record(Id, ScenarioSchema).optional(),
})

export type RootInput = z.infer<typeof RootSchema>
export type FieldInput = z.infer<typeof FieldSchema>
export type Step = z.infer<typeof StepSchema>

export const KNOWN_KEYS = {
  root: Object.keys(RootSchema.shape),
  node: Object.keys(NodeSchema.shape),
  group: Object.keys(GroupSchema.shape),
  edge: Object.keys(EdgeSchema.shape),
  view: Object.keys(ViewSchema.shape),
  scenario: Object.keys(ScenarioBase.shape),
  defaults: Object.keys(DefaultsSchema.shape),
} as const

type Json = Record<string, unknown>

/**
 * JSON Schema for editor autocomplete. The schema Zod emits describes the normalised
 * shape; authors also write shorthand (a string for a node, `a -> b: label` for an edge),
 * so those positions are widened to accept both.
 */
export function authoringJsonSchema(): Json {
  const schema = z.toJSONSchema(RootSchema, { io: 'input', unrepresentable: 'any' }) as Json
  const props = schema.properties as Record<string, Json>

  const widenRecord = (key: string) => {
    const field = props[key]
    if (!field) return
    const value = field.additionalProperties as Json
    field.additionalProperties = { anyOf: [{ type: 'string' }, value] }
  }
  widenRecord('nodes')
  widenRecord('groups')

  const edges = props.edges as Json | undefined
  if (edges) {
    const item = edges.items as Json
    const withoutEndpoints = structuredClone(item)
    const p = withoutEndpoints.properties as Record<string, unknown> | undefined
    if (p) {
      delete p.from
      delete p.to
    }
    withoutEndpoints.required = []
    edges.items = {
      anyOf: [
        { type: 'string', description: 'a -> b, or a <-> b' },
        item,
        {
          type: 'object',
          maxProperties: 1,
          patternProperties: {
            '^\\S+\\s*(<->|->)\\s*\\S+$': {
              anyOf: [{ type: 'string', description: 'label' }, withoutEndpoints],
            },
          },
        },
      ],
    }
  }
  // Steps have three shorthand forms (`a -> b: label`, `at node: label`, `par:`), so keep them open.
  const stepItem = {
    anyOf: [{ type: 'string' }, { type: 'object' }],
    description:
      'a -> b: label | at node: label | par: [steps] | { from, to, label, kind, note, status, via }',
  }
  const scenarios = props.scenarios as Json | undefined
  const scenario = scenarios?.additionalProperties as Json | undefined
  const sp = scenario?.properties as Record<string, Json> | undefined
  if (sp) {
    if (sp.steps) sp.steps.items = stepItem
    const phaseItem = (sp.phases?.items as Json | undefined)?.properties as
      | Record<string, Json>
      | undefined
    if (phaseItem?.steps) phaseItem.steps.items = stepItem
  }
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'idocs diagram',
    ...schema,
  }
}
