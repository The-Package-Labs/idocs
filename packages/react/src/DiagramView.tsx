import {
  buildTimeline,
  type CompiledDiagram,
  type CompiledNode,
  type CompiledView,
  DEFAULT_NODE_WIDTH,
  type Diagrams,
  defaultExpanded,
  type Frame,
  frameAt,
  type Layout,
  measurable,
  type NestedLayout,
  type Rect,
  rectOfPath,
} from '@the-package-labs/idocs-core'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Canvas, type Focus } from './Canvas'
import { Drawer } from './Drawer'
import { EdgeLayer, type EdgeState } from './EdgeLayer'
import { focusOf } from './focus'
import { readHashValue, readScenarioHash, trailKey, writeHash } from './hash'
import { InlineDiagram } from './InlineDiagram'
import { InterfaceTable } from './InterfaceTable'
import { insideOf } from './inside'
import { Legend } from './Legend'
import { NodeCard, type NodeCardState, type NodeInside } from './NodeCard'
import { Packets } from './Packets'
import { Player } from './Player'
import { SequenceView } from './SequenceView'
import { StepPanel } from './StepPanel'
import { StoryView } from './StoryView'
import { type Crumb, Trail } from './Trail'
import { useLayout } from './useLayout'
import { usePlayer } from './usePlayer'
import { cx } from './util'
import { Zones } from './Zones'

export interface DiagramViewProps {
  diagram: CompiledDiagram
  /** View to show first. Defaults to the diagram's first view. */
  view?: string
  /** Scenario to select first. */
  scenario?: string
  /** How a scenario is shown. Defaults to the scenario's own `mode`, then `flow`. */
  mode?: 'flow' | 'sequence' | 'story'
  /** Tallest the canvas may grow before it scrolls inside its frame, in px. */
  maxHeight?: number
  showTitle?: boolean
  /** Show the diagram's description above the first view. */
  showDescription?: boolean
  /** Play `scenario` as soon as it is laid out. Ignored when the system asks for reduced motion. */
  autoplay?: boolean
  /** Keep the selected scenario and step in the URL hash so they can be shared. */
  hash?: boolean
  className?: string
  /** Handle node clicks externally, for example in a visual editor. Replaces the detail drawer. */
  onNodeSelect?: (id: string) => void
  /** Highlight a node selected by an external editor. */
  selectedNode?: string | null
  /** Called when a node is clicked, in addition to whatever the click already does (opening the drawer). */
  onNodeOpen?: (id: string) => void
  /** Outline a node from outside without opening its drawer, for example the one under an editor's cursor. */
  highlightNode?: string | null
}

const EMPTY: EdgeState = {}

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** One step of the way down: the node opened in the level above, and the diagram it held. */
interface Opened {
  node: string
  diagram: string
}

const MOTION_MS = 450
const PULSE_MS = 1800

export function DiagramView(props: DiagramViewProps) {
  const { diagram, hash = true, className } = props
  // What a node with a `diagram:` key opens travels inside the diagram that holds it. A node
  // whose diagram is not there is drawn like any other.
  const diagrams = diagram.nested
  const rootRef = useRef<HTMLDivElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const [opened, setOpened] = useState<Opened[]>([])
  // Which level is animating in or out, and the node to pulse after coming back to a level.
  const [moving, setMoving] = useState<{ level: number; dir: 'in' | 'out' } | null>(null)
  const [returned, setReturned] = useState<{ level: number; node: string } | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  // Where each opened node was on screen, so the animation can zoom into it and back out of it.
  const origins = useRef<({ x: number; y: number } | undefined)[]>([])
  // Focus goes back to the node only when the reader got in with the keyboard.
  const refocus = useRef(false)

  // The diagram shown at each depth, with the node that was opened to get there. A step that no
  // longer holds (the diagram was edited while it was open) ends the chain.
  const chain = useMemo(() => {
    const out: { diagram: CompiledDiagram; via?: CompiledNode }[] = [{ diagram }]
    for (const o of opened) {
      const via = out[out.length - 1]!.diagram.nodes[o.node]
      const next = via?.diagram?.name === o.diagram ? diagrams?.[o.diagram] : undefined
      if (!via || !next) break
      out.push({ diagram: next, via })
    }
    return out
  }, [diagram, diagrams, opened])
  const depth = chain.length - 1
  const canOpen = !!diagrams && Object.keys(diagrams).length > 0

  const hashKeyAt = (level: number) =>
    [diagram.name, ...opened.slice(0, level).map((o) => o.diagram)].join('/')

  // The way down is part of the link: #<diagram>~=node/node
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the first render restores
  useEffect(() => {
    const path = hash && diagrams ? readHashValue(trailKey(diagram.name)) : null
    if (!path) return
    const steps: Opened[] = []
    let here = diagram
    for (const id of path.split('/')) {
      const ref = here.nodes[id]?.diagram
      const next = ref && diagrams?.[ref.name]
      if (!ref || !next) break
      steps.push({ node: id, diagram: ref.name })
      here = next
    }
    if (steps.length) setOpened(steps)
  }, [])
  useEffect(() => {
    if (!hash) return
    writeHash(
      trailKey(diagram.name),
      opened
        .slice(0, depth)
        .map((o) => o.node)
        .join('/') || null,
    )
  }, [hash, diagram.name, opened, depth])

  const aim = (point: { x: number; y: number } | undefined) => {
    if (!point) return
    rootRef.current?.style.setProperty('--idocs-dive-x', `${Math.round(point.x)}px`)
    rootRef.current?.style.setProperty('--idocs-dive-y', `${Math.round(point.y)}px`)
  }

  /**
   * Move into the diagram a node holds. `path` is the node's id, or ids joined with `/` for one
   * inside nodes shown in place (`orders/stock`): the levels in between are opened too, so the
   * trail still says how the reader got there.
   */
  const open = (level: number, path: string) => {
    const steps: Opened[] = []
    let here = chain[level]?.diagram
    for (const id of path.split('/')) {
      const ref = here?.nodes[id]?.diagram
      const next = ref && diagrams?.[ref.name]
      if (!ref || !next) return
      steps.push({ node: id, diagram: ref.name })
      here = next
    }
    const levelEl = rootRef.current?.querySelector<HTMLElement>(`[data-level="${level}"]`)
    const card = levelEl?.querySelector<HTMLElement>(`[data-node="${path}"]`)
    if (levelEl && card) {
      const l = levelEl.getBoundingClientRect()
      const c = card.getBoundingClientRect()
      origins.current[level] = { x: c.left + c.width / 2 - l.left, y: c.top + c.height / 2 - l.top }
    }
    aim(origins.current[level])
    refocus.current = !!document.activeElement?.matches?.(':focus-visible')
    setOpened((prev) => [...prev.slice(0, level), ...steps])
    setReturned(null)
    setMoving({ level: level + steps.length, dir: 'in' })
  }

  /** Land on `level`, closing every level below it. */
  const goTo = (level: number) => {
    if (level < 0 || level >= depth) return
    for (let l = level + 1; l <= depth; l++) {
      writeHash(hashKeyAt(l), null)
      writeHash(`${hashKeyAt(l)}+`, null)
    }
    aim(origins.current[level])
    refocus.current = !!document.activeElement?.matches?.(':focus-visible')
    const via = opened[level]
    setOpened((prev) => prev.slice(0, level))
    setReturned(via ? { level, node: via.node } : null)
    setMoving({ level, dir: 'out' })
  }
  const back = () => goTo(depth - 1)

  useEffect(() => {
    if (!moving) return
    const t = window.setTimeout(() => setMoving(null), MOTION_MS)
    return () => window.clearTimeout(t)
  }, [moving])
  useEffect(() => {
    if (!returned) return
    const t = window.setTimeout(() => setReturned(null), PULSE_MS)
    return () => window.clearTimeout(t)
  }, [returned])

  // Into a level: the reader lands on the way back, which also scopes Escape to this widget.
  useEffect(() => {
    if (depth === 0) return
    backRef.current?.focus({ preventScroll: true })
    const top = rootRef.current?.getBoundingClientRect().top ?? 0
    if (top < 0) rootRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [depth])
  // Back out: a keyboard reader finds themselves on the card they opened.
  useEffect(() => {
    if (!returned || !refocus.current) return
    refocus.current = false
    const there = rootRef.current?.querySelector<HTMLElement>(
      `[data-level="${returned.level}"] [data-node="${returned.node}"]`,
    )
    // A node shown in place is a group: its name is the thing to land on.
    const target = there?.hasAttribute('data-inline')
      ? there.querySelector<HTMLElement>('.idocs-inline-title')
      : there
    target?.focus({ preventScroll: true })
  }, [returned])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = () => {
    // Refused, for example, in an iframe that was not given the permission; nothing to report.
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else rootRef.current?.requestFullscreen?.()?.catch(() => {})
  }
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled !== false

  const crumbs: Crumb[] = [
    { key: diagram.name, label: diagram.title, title: 'Back to the top' },
    ...chain.slice(1).map((c) => ({
      key: c.diagram.name,
      label: c.via!.title,
      title: c.diagram.title,
      icon: c.via!.icon,
    })),
  ]

  return (
    <div ref={rootRef} className={cx('idocs', className)} data-diagram={diagram.name}>
      {depth > 0 && <Trail ref={backRef} crumbs={crumbs} onJump={goTo} onBack={back} />}
      {chain.map(({ diagram: d, via: node }, level) => {
        const top = level === depth
        const first = level === 0
        const via = node?.diagram
        return (
          <div
            key={d.name}
            className={cx(
              'idocs-level',
              moving?.level === level && (moving.dir === 'in' ? 'is-entering' : 'is-returning'),
            )}
            data-level={level}
            hidden={!top}
          >
            <Level
              diagram={d}
              diagrams={diagrams}
              view={first ? props.view : via?.view}
              scenario={first ? props.scenario : via?.scenario}
              mode={first ? props.mode : undefined}
              maxHeight={props.maxHeight}
              showTitle={first ? props.showTitle : false}
              showDescription={first ? props.showDescription : true}
              autoplay={first ? props.autoplay : false}
              hash={hash}
              hashKey={hashKeyAt(level)}
              active={top}
              fullscreen={fullscreen}
              onToggleFullscreen={canFullscreen ? toggleFullscreen : undefined}
              within={rootRef}
              onOpen={canOpen ? (id) => open(level, id) : undefined}
              onBack={top && !first ? back : undefined}
              origin={top && returned?.level === level ? returned.node : null}
              onNodeSelect={first ? props.onNodeSelect : undefined}
              selectedNode={first ? props.selectedNode : undefined}
              onNodeOpen={first ? props.onNodeOpen : undefined}
              highlightNode={first ? props.highlightNode : null}
            />
          </div>
        )
      })}
    </div>
  )
}

interface LevelProps
  extends Pick<
    DiagramViewProps,
    | 'diagram'
    | 'view'
    | 'scenario'
    | 'mode'
    | 'maxHeight'
    | 'showTitle'
    | 'showDescription'
    | 'autoplay'
    | 'hash'
    | 'onNodeSelect'
    | 'selectedNode'
    | 'onNodeOpen'
    | 'highlightNode'
  > {
  /** Everything the first level can open, by name: the same for every level of a trail. */
  diagrams?: Record<string, CompiledDiagram>
  /** Key of this level's scenario in the URL hash. */
  hashKey: string
  /** False while a diagram opened from this one covers it: the player pauses and keys go elsewhere. */
  active: boolean
  fullscreen: boolean
  onToggleFullscreen?: () => void
  /** The element Escape is scoped to, so a page with other widgets is left alone. */
  within: React.RefObject<HTMLElement | null>
  /**
   * Move into the diagram held by a node, named by its path (`orders`, or `orders/stock` for one
   * inside a node shown in place). Absent when nothing can be opened from here.
   */
  onOpen?: (path: string) => void
  /** Present on every level but the first: go up one. */
  onBack?: () => void
  /** The node the reader has just come back from. */
  origin?: string | null
}

/** One diagram with its views, scenarios, player and drawer. The levels of a trail each get one. */
function Level({
  diagram,
  diagrams,
  view: viewProp,
  scenario: scenarioProp,
  mode: modeProp,
  maxHeight = 780,
  showTitle = false,
  showDescription = false,
  autoplay: autoplayProp = false,
  hash = true,
  hashKey,
  active,
  fullscreen,
  onToggleFullscreen,
  within,
  onOpen,
  onBack,
  origin,
  onNodeSelect,
  selectedNode,
  onNodeOpen,
  highlightNode,
}: LevelProps) {
  const uid = useId().replace(/:/g, '')
  const paths = useRef(new Map<string, SVGPathElement>()).current
  const register = useCallback(
    (id: string, el: SVGPathElement | null) => {
      if (el) paths.set(id, el)
      else paths.delete(id)
    },
    [paths],
  )

  const [viewId, setViewId] = useState(
    () =>
      viewProp ??
      diagram.scenarios.find((s) => s.id === scenarioProp)?.view ??
      diagram.views[0]!.id,
  )
  const view = diagram.views.find((v) => v.id === viewId) ?? diagram.views[0]!
  const scenarios = useMemo(
    () => diagram.scenarios.filter((s) => s.view === view.id),
    [diagram, view.id],
  )
  const [scenarioId, setScenarioId] = useState<string | null>(scenarioProp ?? null)
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? null
  const [mode, setMode] = useState<'flow' | 'sequence' | 'story'>(
    () => modeProp ?? diagram.scenarios.find((s) => s.id === scenarioProp)?.mode ?? 'flow',
  )
  const [hover, setHover] = useState<{ node?: string; edge?: string }>({})
  const [internalSelected, setSelected] = useState<string | null>(null)
  const selected = selectedNode === undefined ? internalSelected : selectedNode
  const [hidePlanned, setHidePlanned] = useState(false)
  // null means automatic: follow the action when the diagram is too big to read at once.
  const [follow, setFollow] = useState<boolean | null>(null)

  // Nodes shown in place, as paths: `orders`, and `orders/stock` inside it. The author may have
  // asked for some to start that way.
  const [expanded, setExpanded] = useState<string[]>(() => defaultExpanded(diagram, diagrams ?? {}))
  const expandedSet = useMemo(() => new Set(expanded), [expanded])
  const reach: Diagrams = diagrams ?? NO_DIAGRAMS

  const { layout, nested, generation, error, measureRef } = useLayout(
    diagram,
    view.id,
    active,
    expandedSet,
    reach,
  )

  const timeline = useMemo(() => {
    if (!layout || !scenario) return null
    const lengths = Object.fromEntries(
      Object.entries(layout.edges).map(([id, e]) => [id, e.length]),
    )
    return buildTimeline(scenario, lengths)
  }, [layout, scenario])
  const player = usePlayer(timeline)
  const frame = useMemo<Frame | null>(
    () => (timeline ? frameAt(timeline, player.t) : null),
    [timeline, player.t],
  )
  const scenarioActive = !!frame && (player.t > 0 || player.playing)
  const stepIndex = frame?.stepIndex ?? -1

  // A scenario chosen by clicking starts playing, and so does one the page asked to autoplay.
  // One restored from the URL waits for the reader.
  const [startPlaying] = useState(
    () => autoplayProp && scenarioProp !== undefined && !prefersReducedMotion(),
  )
  const autoplay = useRef(startPlaying)
  const pendingStep = useRef<number | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to a new timeline
  useEffect(() => {
    if (!timeline) return
    if (pendingStep.current !== null) {
      autoplay.current = false
      player.showStep(Math.min(pendingStep.current, timeline.steps.length - 1))
      pendingStep.current = null
    } else if (autoplay.current) {
      autoplay.current = false
      player.play()
    }
  }, [timeline])

  const selectScenario = (id: string | null) => {
    autoplay.current = id !== null && !prefersReducedMotion()
    setScenarioId(id)
    setHover({})
    if (id === null) setMode('flow')
    else {
      const picked = scenarios.find((s) => s.id === id)
      if (picked?.mode) setMode(picked.mode)
    }
  }

  const selectView = (id: string) => {
    setViewId(id)
    setScenarioId(null)
    setSelected(null)
    setMode('flow')
  }

  // Deep links: #<diagram>=<scenario>[.<step>]
  useEffect(() => {
    if (!hash) return
    const hit = readScenarioHash(hashKey)
    if (!hit) return
    const sc = diagram.scenarios.find((s) => s.id === hit.scenario)
    if (!sc) return
    setViewId(sc.view)
    setScenarioId(sc.id)
    if (sc.mode) setMode(sc.mode)
    if (hit.step) pendingStep.current = hit.step - 1
  }, [diagram, hash, hashKey])

  useEffect(() => {
    if (!hash || player.playing) return
    writeHash(
      hashKey,
      scenarioId ? `${scenarioId}${stepIndex >= 0 ? `.${stepIndex + 1}` : ''}` : null,
    )
  }, [hash, hashKey, scenarioId, stepIndex, player.playing])

  // What is shown in place is part of the link too: #<diagram>+=orders,orders/stock. It is only
  // written when it differs from what the author started with, and `none` says "all folded".
  const startedWith = useRef(expanded).current
  useEffect(() => {
    if (!hash) return
    const value = readHashValue(`${hashKey}+`)
    if (value) setExpanded(value === 'none' ? [] : value.split(','))
  }, [hash, hashKey])
  useEffect(() => {
    if (!hash) return
    const same =
      expanded.length === startedWith.length && expanded.every((p) => startedWith.includes(p))
    writeHash(`${hashKey}+`, same ? null : expanded.join(',') || 'none')
  }, [hash, hashKey, expanded, startedWith])

  // Whatever was playing waits where it is until the reader comes back.
  const pausePlayer = player.pause
  useEffect(() => {
    if (!active) pausePlayer()
  }, [active, pausePlayer])

  // Escape goes up a level, unless the drawer is open (it closes first) or focus is elsewhere.
  useEffect(() => {
    if (!active || !onBack || selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      const at = document.activeElement
      if (at && at !== document.body && !within.current?.contains(at)) return
      e.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onBack, selected, within])

  const onHoverNode = useCallback((id: string | null) => setHover(id ? { node: id } : {}), [])
  const onHoverEdge = useCallback((id: string | null) => setHover(id ? { edge: id } : {}), [])
  // A path with a `/` names a node inside one shown in place; an editor only knows the first level.
  const onSelect = useCallback(
    (id: string) => {
      const top = !id.includes('/')
      if (top) onNodeOpen?.(id)
      if (onNodeSelect) {
        if (top) onNodeSelect(id)
      } else setSelected((cur) => (cur === id ? null : id))
    },
    [onNodeSelect, onNodeOpen],
  )
  const closeDrawer = useCallback(() => setSelected(null), [])

  // Show a node's diagram in place, or fold it back. The camera then moves to it once the new
  // layout is there: `after` is the layout the reader was looking at when they asked.
  const [reveal, setReveal] = useState<{ path: string; after: number } | null>(null)
  const generationNow = useRef(generation)
  generationNow.current = generation
  const toggleExpand = useCallback((path: string) => {
    // The card under the pointer is about to be replaced and will never say the pointer left it.
    setHover({})
    setExpanded((cur) => (cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path]))
    // A node that is folded away cannot stay selected.
    setSelected((cur) => (cur?.startsWith(`${path}/`) ? null : cur))
    setReveal({ path, after: generationNow.current })
  }, [])
  const openPath = useCallback((path: string) => onOpen?.(path), [onOpen])

  // What a reader may do with the diagram a node holds, said on the card before they do it.
  const canOpen = !!onOpen
  const insides = useMemo(() => {
    const out: Record<string, NodeInside> = {}
    for (const id of view.nodeIds) {
      const inside = insideOf(diagram.nodes[id]!, diagrams, canOpen)
      if (inside) out[id] = inside
    }
    return out
  }, [diagram, diagrams, view, canOpen])

  // A highlight from outside counts while it names a node of this view and no scenario is under
  // way; otherwise it would dim a diagram it cannot point into, or fight a paused scenario.
  const outside =
    !scenarioActive && highlightNode && view.nodeIds.includes(highlightNode) ? highlightNode : null

  // Which nodes and edges the pointer (or the open drawer) is pointing at. A node inside one shown
  // in place stays out of it: the outer diagram is not about it.
  const staying = selected && !selected.includes('/') ? selected : outside
  const focus = useMemo(() => {
    if (scenarioActive && player.playing) return null
    return focusOf(diagram, view, hover, staying)
  }, [hover, staying, scenarioActive, player.playing, diagram, view])

  const activeKey = frame?.activeEdges.join() ?? ''
  const trailKey = frame?.trailEdges.join() ?? ''
  const visitedKey = frame?.visitedNodes.join() ?? ''

  const nodeFlags = useMemo(() => {
    const visited = new Set(visitedKey ? visitedKey.split(',') : [])
    const out: Record<string, NodeCardState> = {}
    for (const id of view.nodeIds) {
      out[id] = {
        selected: selected === id || outside === id,
        hl: !!focus?.nodes.has(id),
        dim: focus ? !focus.nodes.has(id) : scenarioActive ? !visited.has(id) : false,
        visited: scenarioActive && visited.has(id),
        hidden: hidePlanned && diagram.nodes[id]!.status === 'planned',
        origin: origin === id,
      }
    }
    return out
  }, [view, focus, selected, outside, scenarioActive, visitedKey, hidePlanned, diagram, origin])

  const edgeStates = useMemo(() => {
    const active = new Set(activeKey ? activeKey.split(',') : [])
    const trail = new Set(trailKey ? trailKey.split(',') : [])
    const out: Record<string, EdgeState> = {}
    for (const id of view.edgeIds) {
      const e = diagram.edges[id]!
      const hidden =
        hidePlanned &&
        (e.status === 'planned' ||
          diagram.nodes[e.from]!.status === 'planned' ||
          diagram.nodes[e.to]!.status === 'planned')
      out[id] = {
        hl: !!focus?.edges.has(id),
        dim: focus ? !focus.edges.has(id) : scenarioActive ? !trail.has(id) : false,
        lit: scenarioActive && active.has(id),
        trail: scenarioActive && trail.has(id) && !active.has(id),
        hidden,
      }
    }
    return out
  }, [view, focus, scenarioActive, activeKey, trailKey, hidePlanned, diagram])

  const hasPlanned = useMemo(
    () =>
      view.nodeIds.some((id) => diagram.nodes[id]!.status === 'planned') ||
      view.edgeIds.some((id) => diagram.edges[id]!.status === 'planned'),
    [view, diagram],
  )

  const following = follow ?? (!!layout && (layout.width > 1500 || layout.height > 950))
  const followCamera = useMemo<Focus | null>(() => {
    if (!following || !layout || !scenario || !timeline || mode !== 'flow') return null
    if (stepIndex < 0)
      return {
        key: `${scenario.id}:start`,
        rect: { x: 0, y: 0, w: layout.width, h: layout.height },
      }
    const step = scenario.steps[stepIndex]
    if (!step) return null
    const group = step.par === undefined ? [step] : scenario.steps.filter((s) => s.par === step.par)
    const boxes: Rect[] = []
    for (const s of group) {
      for (const id of [s.from, s.to, s.at])
        if (id && layout.nodes[id]) boxes.push(layout.nodes[id]!)
      for (const hop of s.hops)
        for (const p of layout.edges[hop.edge]?.points ?? [])
          boxes.push({ x: p.x, y: p.y, w: 0, h: 0 })
    }
    if (!boxes.length) return null
    const x0 = Math.min(...boxes.map((b) => b.x))
    const y0 = Math.min(...boxes.map((b) => b.y))
    const x1 = Math.max(...boxes.map((b) => b.x + b.w))
    const y1 = Math.max(...boxes.map((b) => b.y + b.h))
    return {
      key: `${scenario.id}:${step.par ?? step.id}`,
      rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    }
  }, [following, layout, scenario, timeline, stepIndex, mode])
  const revealCamera = useMemo<Focus | null>(() => {
    if (!reveal || !nested || generation <= reveal.after) return null
    const rect = rectOfPath(nested, reveal.path)
    return rect ? { key: `reveal:${reveal.path}:${reveal.after}`, rect } : null
  }, [reveal, nested, generation])
  const camera = revealCamera ?? followCamera
  const stopFollowing = useCallback(() => setFollow(false), [])

  // The node the drawer is about: at the top, or inside a node shown in place.
  const target = useMemo(
    () => resolvePath(selected, diagram, view, nested, reach),
    [selected, diagram, view, nested, reach],
  )

  const stateOf = useCallback((id: string) => edgeStates[id] ?? EMPTY, [edgeStates])
  const presentation = scenario ? mode : 'flow'

  return (
    <>
      {showTitle && <h3 style={{ margin: 0 }}>{diagram.title}</h3>}
      {(showTitle || showDescription) && diagram.descriptionHtml && (
        <div
          className="idocs-summary"
          dangerouslySetInnerHTML={{ __html: diagram.descriptionHtml }}
        />
      )}

      {diagram.views.length > 1 && (
        <div className="idocs-tabs" role="tablist" aria-label="Views">
          {diagram.views.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              className="idocs-tab"
              aria-selected={v.id === view.id}
              onClick={() => selectView(v.id)}
            >
              {v.title}
            </button>
          ))}
        </div>
      )}
      {view.summaryHtml && (
        <div className="idocs-summary" dangerouslySetInnerHTML={{ __html: view.summaryHtml }} />
      )}

      {scenarios.length > 0 && (
        <div className="idocs-scenarios" role="group" aria-label="Scenarios">
          <span className="idocs-scenarios-label">Scenario</span>
          <button
            type="button"
            className="idocs-chip-btn"
            aria-pressed={!scenario}
            onClick={() => selectScenario(null)}
          >
            Overview
          </button>
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              className="idocs-chip-btn"
              aria-pressed={s.id === scenario?.id}
              onClick={() => selectScenario(s.id)}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}
      {scenario?.summaryHtml && (
        <div className={cx('idocs-summary', presentation === 'story' && 'is-card')}>
          {presentation === 'story' && (
            <strong className="idocs-summary-title">The story in one breath</strong>
          )}
          <div dangerouslySetInnerHTML={{ __html: scenario.summaryHtml }} />
        </div>
      )}

      {presentation === 'flow' && <Legend diagram={diagram} view={view} />}

      {scenario && presentation === 'sequence' ? (
        <SequenceView
          diagram={diagram}
          scenario={scenario}
          current={stepIndex}
          onSeek={player.playStep}
        />
      ) : scenario && presentation === 'story' ? (
        <StoryView
          diagram={diagram}
          scenario={scenario}
          current={stepIndex}
          ended={player.ended}
          onSeek={player.playStep}
        />
      ) : layout ? (
        <Canvas
          layout={layout}
          maxHeight={maxHeight}
          fullscreen={fullscreen}
          onToggleFullscreen={onToggleFullscreen}
          onBackgroundClick={closeDrawer}
          focus={camera}
          onUserMove={stopFollowing}
          tools={
            <>
              {scenario && (
                <div className="idocs-toolbar-group">
                  <button
                    type="button"
                    className="idocs-tool is-text"
                    aria-pressed={following}
                    onClick={() => setFollow(!following)}
                    title="Move the view to wherever the action is"
                  >
                    Follow
                  </button>
                </div>
              )}
              {hasPlanned && (
                <div className="idocs-toolbar-group">
                  <button
                    type="button"
                    className="idocs-tool is-text"
                    aria-pressed={hidePlanned}
                    onClick={() => setHidePlanned((v) => !v)}
                    title="Hide items that are not built yet"
                  >
                    {hidePlanned ? 'Planned hidden' : 'Hide planned'}
                  </button>
                </div>
              )}
            </>
          }
          overlay={
            active &&
            selected &&
            target &&
            !onNodeSelect && (
              <Drawer
                diagram={target.diagram}
                view={target.view}
                nodeId={target.id}
                inside={insideOf(target.diagram.nodes[target.id]!, reach, canOpen)}
                expanded={expandedSet.has(selected)}
                onExpand={() => toggleExpand(selected)}
                onOpen={() => openPath(selected)}
                onClose={closeDrawer}
                onSelect={(id) => setSelected(`${target.prefix}${id}`)}
              />
            )
          }
        >
          <World
            uid={uid}
            diagram={diagram}
            view={view}
            layout={layout}
            nodeFlags={nodeFlags}
            stateOf={stateOf}
            edgeStates={edgeStates}
            register={register}
            nested={nested}
            diagrams={reach}
            insides={insides}
            selected={selected}
            hidePlanned={hidePlanned}
            onHoverNode={onHoverNode}
            onHoverEdge={onHoverEdge}
            onSelect={onSelect}
            onToggle={toggleExpand}
            onOpen={canOpen ? openPath : undefined}
          />
          {frame && scenarioActive && <Packets frame={frame} layout={layout} paths={paths} />}
        </Canvas>
      ) : (
        <div className="idocs-frame idocs-skeleton">
          {error ? <div className="idocs-error">{error}</div> : 'Loading diagram…'}
        </div>
      )}

      {scenario && timeline && (
        <Player
          player={player}
          timeline={timeline}
          mode={mode}
          onMode={setMode}
          stepIndex={stepIndex}
        />
      )}
      {scenario && (
        <StepPanel
          diagram={diagram}
          scenario={scenario}
          current={stepIndex}
          ended={player.ended}
          onSeek={player.playStep}
        />
      )}
      {view.interfaces && (
        <InterfaceTable
          diagram={diagram}
          view={view}
          hover={hover.edge ?? null}
          onHover={onHoverEdge}
        />
      )}

      <div className="idocs-measure" ref={measureRef} aria-hidden="true">
        {measurable(diagram, view.id, expandedSet, reach).map(({ key, node }) => (
          <NodeCard
            key={key}
            node={node}
            path={key}
            measure
            inside={insideOf(node, reach, canOpen)}
            style={{ width: node.w ?? DEFAULT_NODE_WIDTH }}
          />
        ))}
      </div>
    </>
  )
}

interface WorldProps {
  uid: string
  diagram: CompiledDiagram
  view: CompiledView
  layout: Layout
  /** The layout with the diagrams shown in place: what is expanded is whatever it holds. */
  nested: NestedLayout | null
  diagrams: Diagrams
  nodeFlags: Record<string, NodeCardState>
  edgeStates: Record<string, EdgeState>
  stateOf: (id: string) => EdgeState
  register: (id: string, el: SVGPathElement | null) => void
  insides: Record<string, NodeInside>
  selected: string | null
  hidePlanned: boolean
  onHoverNode: (id: string | null) => void
  onHoverEdge: (id: string | null) => void
  onSelect: (path: string) => void
  onToggle: (path: string) => void
  onOpen?: (path: string) => void
}

/** Zones, edges and nodes. Memoised so the per-frame player updates do not touch it. */
const World = memo(function World({
  uid,
  diagram,
  view,
  layout,
  nested,
  diagrams,
  nodeFlags,
  stateOf,
  register,
  insides,
  selected,
  hidePlanned,
  onHoverNode,
  onHoverEdge,
  onSelect,
  onToggle,
  onOpen,
}: WorldProps) {
  const noDim = useCallback(() => false, [])
  return (
    <>
      <Zones diagram={diagram} groupIds={view.groupIds} layout={layout} dim={noDim} />
      <EdgeLayer
        uid={uid}
        diagram={diagram}
        view={view}
        layout={layout}
        stateOf={stateOf}
        onHover={onHoverEdge}
        register={register}
      />
      {view.nodeIds.map((id) => {
        const r = layout.nodes[id]
        if (!r) return null
        const here = nested?.layout === layout ? nested.inner[id] : undefined
        const child = here && diagrams[here.name]
        if (here && child && insides[id]) {
          return (
            <InlineDiagram
              key={id}
              uid={uid}
              path={id}
              node={diagram.nodes[id]!}
              rect={r}
              child={child}
              view={child.views.find((v) => v.id === here.viewId)!}
              inner={here}
              diagrams={diagrams}
              state={nodeFlags[id]}
              inside={insides[id]!}
              selected={selected}
              hidePlanned={hidePlanned}
              onSelect={onSelect}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          )
        }
        return (
          <NodeCard
            key={id}
            node={diagram.nodes[id]!}
            style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
            state={nodeFlags[id]}
            inside={insides[id]}
            onSelect={onSelect}
            onExpand={onToggle}
            onOpen={onOpen}
            onHover={onHoverNode}
          />
        )
      })}
    </>
  )
})

const NO_DIAGRAMS: Diagrams = {}

/**
 * The diagram, view and node a path names, following the diagrams shown in place. `prefix` is what
 * to put before an id to name a sibling of it. Null when the path leads nowhere (it was folded).
 */
function resolvePath(
  path: string | null,
  diagram: CompiledDiagram,
  view: CompiledView,
  nested: NestedLayout | null,
  diagrams: Diagrams,
): { diagram: CompiledDiagram; view: CompiledView; id: string; prefix: string } | null {
  if (!path) return null
  const ids = path.split('/')
  const id = ids.pop()!
  let at = diagram
  let atView = view
  let layout = nested
  for (const step of ids) {
    const here = layout?.inner[step]
    const next = here && diagrams[here.name]
    const nextView = next?.views.find((v) => v.id === here?.viewId)
    if (!here || !next || !nextView) return null
    at = next
    atView = nextView
    layout = here.layout
  }
  if (!at.nodes[id]) return null
  return { diagram: at, view: atView, id, prefix: ids.length ? `${ids.join('/')}/` : '' }
}
