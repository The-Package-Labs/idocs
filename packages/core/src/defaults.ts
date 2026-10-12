import type { EdgeKindDef, Family } from './types'

export interface KindDef {
  icon: string
  family?: Family
}

/** Node kinds that ship with the tool. A diagram can add or override kinds in `kinds:`. */
export const BUILTIN_KINDS: Record<string, KindDef> = {
  client: { icon: 'lucide:monitor', family: 'slate' },
  user: { icon: 'lucide:user', family: 'slate' },
  ui: { icon: 'lucide:layout-dashboard', family: 'slate' },
  external: { icon: 'lucide:cloud', family: 'slate' },
  service: { icon: 'lucide:server', family: 'blue' },
  gateway: { icon: 'lucide:route', family: 'blue' },
  worker: { icon: 'lucide:cog', family: 'blue' },
  container: { icon: 'lucide:container', family: 'blue' },
  function: { icon: 'lucide:square-function', family: 'blue' },
  database: { icon: 'lucide:database', family: 'green' },
  cache: { icon: 'lucide:zap', family: 'green' },
  storage: { icon: 'lucide:hard-drive', family: 'green' },
  queue: { icon: 'lucide:list-ordered', family: 'amber' },
  agent: { icon: 'lucide:bot', family: 'violet' },
  network: { icon: 'lucide:network', family: 'violet' },
  vm: { icon: 'lucide:box', family: 'violet' },
  auth: { icon: 'lucide:key-round', family: 'teal' },
  monitor: { icon: 'lucide:activity', family: 'teal' },
  entity: { icon: 'lucide:table-2', family: 'blue' },
}

export const BUILTIN_EDGE_KINDS: Record<string, EdgeKindDef> = {
  http: { label: 'HTTP request / response', color: 'ink', width: 1.5 },
  channel: { label: 'Persistent channel (websocket, gRPC)', color: 'accent', width: 2.4 },
  tunnel: { label: 'Overlay tunnel', color: 'tunnel', width: 5 },
  queue: { label: 'Queue / broker', color: 'ok', width: 2, dash: '2 4' },
  ws: { label: 'WebSocket', color: 'ink', width: 1.6, dash: '7 4' },
  data: { label: 'Data access', color: 'muted', width: 1.3 },
  relation: { label: 'Relation between entities', color: 'muted', width: 1.4 },
}

export const STEP_KIND_COLORS: Record<string, string> = {
  request: 'accent',
  response: 'ok',
  error: 'bad',
  lookup: 'muted',
  event: 'warn',
}

export const DEFAULT_NODE_WIDTH = 178
/** Cards with fields need room for a name and a type side by side. */
export const DEFAULT_ENTITY_WIDTH = 280
