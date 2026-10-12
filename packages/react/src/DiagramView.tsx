import {
  buildOutline,
  buildTimeline,
  type CompiledDiagram,
  type CompiledNode,
  type CompiledView,
  DEFAULT_NODE_WIDTH,
  type Diagrams,
  defaultExpanded,
  defaultMode,
  type Frame,
  frameAt,
  type Layout,
  measurable,
  type NestedLayout,
  openingView,
  type Rect,
  rectOfPath,
  startOf,
} from '@the-package-labs/idocs-core'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Canvas, type Focus } from './Canvas'
import { DRAWER_WIDTH, Drawer } from './Drawer'
import { EdgeLayer, type EdgeState } from './EdgeLayer'
import { focusOf } from './focus'
import {
  OVERVIEW_MARK,
  readHashValue,
  readScenarioHash,
  scenarioHash,
  trailKey,
  writeHash,
} from './hash'
import { InlineDiagram } from './InlineDiagram'
import { InterfaceTable } from './InterfaceTable'
import { insideOf } from './inside'
import { Legend } from './Legend'
import { Markup } from './Markup'
import { NodeCard, type NodeCardState, type NodeInside } from './NodeCard'
import { Outline } from './Outline'
import { Packets } from './Packets'
import { PANEL_GAP, PANEL_WIDTH, Panel, type SideTab } from './Panel'
import { PlayerBar } from './PlayerBar'
import { ScrollFrame } from './ScrollFrame'
import { SequenceView } from './SequenceView'
import { StoryView } from './StoryView'
import { type Crumb, Trail } from './Trail'
import { useLayout } from './useLayout'
import { usePlayer } from './usePlayer'
import { cx, NARROW } from './util'
import { Zones } from './Zones'

export interface DiagramViewProps {
  diagram: CompiledDiagram
  /** View to show first. Defaults to the diagram's `defaults.view`, then its first view. */
  view?: string
  /** Scenario to select first. Defaults to the diagram's `defaults.scenario`. */
  scenario?: string
  /**
   * How a scenario is shown. Defaults to the scenario's own `mode`, then the diagram's
   * `defaults.mode`, then `flow`.
   */
  mode?: 'flow' | 'sequence' | 'story'
  /** Tallest the canvas may grow before it scrolls inside its frame, in px. */
  maxHeight?: number
  showTitle?: boolean
  /** Show the diagram's description above the first view. */
  showDescription?: boolean
  /**
   * Play the scenario selected first as soon as it is laid out. Defaults to the diagram's
   * `defaults.autoplay`. Ignored when the system asks for reduced motion.
   */
  autoplay?: boolean
  /** Keep the selected scenario and step in the URL hash so they can be shared. */
  hash?: boolean
  className?: string
  /**
   * Whether the panel that floats over the picture (outline, scenarios, timeline, views and the
   * player) starts open. A reader can fold it away and bring it back. By default it starts open
   * when there is something to choose, a scenario or another view, and in a frame wide enough to
   * share; otherwise it starts folded. The diagram's `defaults.sidebar` replaces that default but
   * still gives way in a narrow frame; this prop does not.
   */
  sidebar?: boolean
  /**
   * Show what the scenario is doing in words over the picture while it plays. Defaults to the
   * diagram's `defaults.subtitles`, then `true`.
   */
  subtitles?: boolean
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
  // Known only in the browser, and only once mounted: what the server drew must be what the
  // client draws first, or hydration fails.
  const [canFullscreen, setCanFullscreen] = useState(false)
  useEffect(() => setCanFullscreen(document.fullscreenEnabled !== false), [])

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
              sidebar={first ? props.sidebar : undefined}
              subtitles={props.subtitles}
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
    | 'sidebar'
    | 'subtitles'
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
  autoplay: autoplayProp,
  hash = true,
  sidebar: sidebarProp,
  subtitles: subtitlesProp,
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

  // Where it opens: what the page asked for, else what the diagram says about itself.
  const [start] = useState(() =>
    startOf(diagram, { view: viewProp, scenario: scenarioProp, mode: modeProp }),
  )
  const [viewId, setViewId] = useState(start.view)
  const view = diagram.views.find((v) => v.id === viewId) ?? diagram.views[0]!
  const scenarios = useMemo(
    () => diagram.scenarios.filter((s) => s.view === view.id),
    [diagram, view.id],
  )
  const [scenarioId, setScenarioId] = useState<string | null>(start.scenario)
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? null
  const [mode, setMode] = useState<'flow' | 'sequence' | 'story'>(start.mode)
  // The panel: its tabs, whether it is open, and the words it can switch. It opens by itself when
  // there is another view to choose, unless the page or the diagram said otherwise. Scenarios are
  // chosen in the bar under the picture, not here.
  const hasChoices = diagram.views.length > 1
  const [tabState, setTab] = useState<SideTab>(hasChoices ? 'views' : 'outline')
  const [sideOpen, setSideOpen] = useState(sidebarProp ?? diagram.defaults?.sidebar ?? hasChoices)
  // The frame is made tall enough for the panel once the panel has been open, and stays so when it
  // is folded, so folding does not make the page jump.
  const [tall, setTall] = useState(sideOpen)
  const [subtitles, setSubtitles] = useState(subtitlesProp ?? diagram.defaults?.subtitles ?? true)
  // A narrow frame cannot share itself with the panel: it starts folded there, unless the page
  // asked to open it with the `sidebar` prop. What the diagram wrote under `defaults` is meant for
  // a frame with room, so it gives way.
  const workspaceRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the first render decides
  useEffect(() => {
    const width = workspaceRef.current?.clientWidth ?? 0
    if (sidebarProp === undefined && width > 0 && width < NARROW) {
      setSideOpen(false)
      setTall(false)
    }
  }, [])
  const [hover, setHover] = useState<{ node?: string; edge?: string }>({})
  const [internalSelected, setSelected] = useState<string | null>(null)
  const selected = selectedNode === undefined ? internalSelected : selectedNode
  const [hidePlanned, setHidePlanned] = useState(false)
  // The interfaces table starts folded: the reader opens it, and it stays as left across views.
  const [ifacesOpen, setIfacesOpen] = useState(false)
  // null means automatic: follow the action when the diagram is too big to read at once.
  const [follow, setFollow] = useState<boolean | null>(null)

  const tabs: SideTab[] = ['outline', ...(diagram.views.length > 1 ? (['views'] as const) : [])]
  const tab = tabs.includes(tabState) ? tabState : (tabs[0] ?? 'outline')

  // Nodes shown in place, as paths: `orders`, and `orders/stock` inside it. The author may have
  // asked for some to start that way.
  const [expanded, setExpanded] = useState<string[]>(() => defaultExpanded(diagram, diagrams ?? {}))
  const expandedSet = useMemo(() => new Set(expanded), [expanded])
  const reach: Diagrams = diagrams ?? NO_DIAGRAMS

  // Phases the reader folded away. They belong to one scenario, and every presentation of it
  // (the list of steps, the sequence, the story) folds the same ones.
  const [phaseFold, setPhaseFold] = useState<{
    scenario: string
    folded: ReadonlySet<number>
  } | null>(null)
  const foldedPhases =
    phaseFold && phaseFold.scenario === scenario?.id ? phaseFold.folded : NO_PHASES
  const togglePhase = useCallback(
    (phase: number) => {
      if (!scenario) return
      setPhaseFold((cur) => {
        const next = new Set(cur?.scenario === scenario.id ? cur.folded : [])
        if (!next.delete(phase)) next.add(phase)
        return { scenario: scenario.id, folded: next }
      })
    },
    [scenario],
  )
  const foldPhases = useCallback(
    (fold: boolean) => {
      if (!scenario) return
      setPhaseFold({
        scenario: scenario.id,
        folded: new Set(fold ? scenario.phases.map((_, i) => i) : []),
      })
    },
    [scenario],
  )

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
    () =>
      (autoplayProp ?? diagram.defaults?.autoplay ?? false) &&
      start.scenario !== null &&
      !prefersReducedMotion(),
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
    if (id === null) setMode(defaultMode(diagram))
    else {
      const picked = scenarios.find((s) => s.id === id)
      if (picked?.mode) setMode(picked.mode)
    }
  }

  const selectView = (id: string) => {
    setViewId(id)
    setScenarioId(null)
    setSelected(null)
    setMode(defaultMode(diagram))
  }

  // Deep links: #<diagram>=<scenario>[.<step>], or #<diagram>=~ for the overview of a diagram that
  // opens on a scenario of its own.
  useEffect(() => {
    if (!hash) return
    const hit = readScenarioHash(hashKey)
    if (!hit) return
    if (hit.scenario === OVERVIEW_MARK) {
      setScenarioId(null)
      setMode(defaultMode(diagram))
      return
    }
    const sc = diagram.scenarios.find((s) => s.id === hit.scenario)
    if (!sc) return
    setViewId(sc.view)
    setScenarioId(sc.id)
    if (sc.mode) setMode(sc.mode)
    if (hit.step) pendingStep.current = hit.step - 1
  }, [diagram, hash, hashKey])

  useEffect(() => {
    if (!hash || player.playing) return
    // A scenario that has not started has no step to speak of, whatever the list shows as next.
    writeHash(hashKey, scenarioHash(scenarioId, scenarioActive ? stepIndex : -1, start.scenario))
  }, [hash, hashKey, scenarioId, stepIndex, scenarioActive, player.playing, start.scenario])

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

  // Choosing a node from the outline, or from the drawer's list of connections: unlike a click on a
  // card it selects even what is selected already, and the camera moves to the node.
  const [locate, setLocate] = useState<{ path: string; n: number } | null>(null)
  const located = useRef(0)

  // Show a node's diagram in place, or fold it back. The camera then moves to it once the new
  // layout is there: `after` is the layout the reader was looking at when they asked.
  const [reveal, setReveal] = useState<{
    path: string
    after: number
    /** Folding, not showing: the camera then frames what is around the node, not the node. */
    folding: boolean
    /** Where the node was, so the camera can keep it where it was on screen. */
    from?: Rect
  } | null>(null)
  const generationNow = useRef(generation)
  generationNow.current = generation
  const expandedNow = useRef(expanded)
  expandedNow.current = expanded
  const nestedNow = useRef(nested)
  nestedNow.current = nested
  const toggleExpand = useCallback((path: string) => {
    // The card under the pointer is about to be replaced and will never say the pointer left it.
    setHover({})
    setLocate(null)
    setExpanded((cur) => (cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path]))
    // A node that is folded away cannot stay selected.
    setSelected((cur) => (cur?.startsWith(`${path}/`) ? null : cur))
    setReveal({
      path,
      after: generationNow.current,
      folding: expandedNow.current.includes(path),
      from: nestedNow.current ? rectOfPath(nestedNow.current, path) : undefined,
    })
  }, [])
  const openPath = useCallback((path: string) => onOpen?.(path), [onOpen])
  const stopFollowing = useCallback(() => setFollow(false), [])
  const onPick = useCallback(
    (id: string) => {
      const top = !id.includes('/')
      if (top) onNodeOpen?.(id)
      if (onNodeSelect) {
        if (top) onNodeSelect(id)
      } else setSelected(id)
      setReveal(null)
      setLocate({ path: id, n: ++located.current })
      // Asking to look somewhere is taking the camera: a scenario no longer pulls it away.
      if (scenarioActive) stopFollowing()
    },
    [onNodeSelect, onNodeOpen, scenarioActive, stopFollowing],
  )

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
  // After a node is shown or folded, move the camera once the new layout is there. Showing frames
  // the node that grew; folding frames what it sat in: the group around it, or the whole diagram.
  // Either way the node stays where it was on screen first, so nothing jumps.
  const revealCamera = useMemo<Focus | null>(() => {
    if (!reveal || !layout || !nested || generation <= reveal.after) return null
    const here = rectOfPath(nested, reveal.path)
    const parent = reveal.path.includes('/')
      ? rectOfPath(nested, reveal.path.slice(0, reveal.path.lastIndexOf('/')))
      : undefined
    const whole: Rect = { x: 0, y: 0, w: layout.width, h: layout.height }
    const rect = reveal.folding ? (parent ?? whole) : (here ?? whole)
    return {
      key: `reveal:${reveal.path}:${reveal.after}`,
      rect,
      anchor: reveal.from && here ? { from: reveal.from, to: here } : undefined,
    }
  }, [reveal, layout, nested, generation])
  const locateCamera = useMemo<Focus | null>(() => {
    if (!locate || !layout || !nested) return null
    const rect = rectOfPath(nested, locate.path)
    return rect ? { key: `locate:${locate.path}:${locate.n}`, rect, keep: true } : null
  }, [locate, layout, nested])
  // Both are one-shot: when the scenario moves on to its next step the camera is the scenario's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step is the trigger
  useEffect(() => {
    setReveal(null)
    setLocate(null)
  }, [stepIndex, scenarioId])
  const camera = revealCamera ?? locateCamera ?? followCamera

  // The node the drawer is about: at the top, or inside a node shown in place.
  const target = useMemo(
    () => resolvePath(selected, diagram, view, nested, reach),
    [selected, diagram, view, nested, reach],
  )

  const stateOf = useCallback((id: string) => edgeStates[id] ?? EMPTY, [edgeStates])
  const presentation = scenario ? mode : 'flow'

  // The tree of the view: groups, nodes, their connections, and what is shown inside a node.
  const items = useMemo(
    () => buildOutline(diagram, view, { diagrams: reach, expanded: expandedSet }),
    [diagram, view, reach, expandedSet],
  )
  const outline = (
    <Outline
      items={items}
      kinds={diagram.edgeKinds}
      selected={selected}
      hovered={hover.node ?? null}
      onSelect={onPick}
      onHoverNode={onHoverNode}
      onHoverEdge={onHoverEdge}
      onExpand={toggleExpand}
      onOpen={canOpen ? openPath : undefined}
    />
  )

  // The panel floats over the left of the picture. While it is open the picture is fitted to what
  // is left; the frame is sized for it either way, so folding it does not make the page jump.
  const reserve = PANEL_WIDTH + PANEL_GAP * 2
  const inset = sideOpen ? reserve : 0
  const panel = (
    <Panel
      diagram={diagram}
      view={view}
      onView={selectView}
      tab={tab}
      tabs={tabs}
      onTab={setTab}
      open={sideOpen}
      onOpen={(open) => {
        setSideOpen(open)
        if (open) setTall(true)
      }}
      outline={outline}
    />
  )
  const captions = scenario && presentation === 'flow' && (
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
  )

  return (
    <>
      {showTitle && <h3 style={{ margin: 0 }}>{diagram.title}</h3>}
      {(showTitle || showDescription) && diagram.descriptionHtml && (
        <Markup className="idocs-summary" html={diagram.descriptionHtml} />
      )}
      {view.summaryHtml && <Markup className="idocs-summary" html={view.summaryHtml} />}

      <div ref={workspaceRef} className={cx('idocs-workspace', scenarios.length > 0 && 'has-bar')}>
        {presentation === 'flow' && <Legend diagram={diagram} view={view} />}

        {scenario && presentation === 'sequence' ? (
          <ScrollFrame
            maxHeight={maxHeight}
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
            tools={captions}
            panel={panel}
            inset={inset}
            current={stepIndex}
          >
            <SequenceView
              diagram={diagram}
              scenario={scenario}
              current={stepIndex}
              onSeek={player.playStep}
              collapsed={foldedPhases}
              onTogglePhase={togglePhase}
            />
          </ScrollFrame>
        ) : scenario && presentation === 'story' ? (
          <ScrollFrame
            maxHeight={maxHeight}
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
            tools={captions}
            panel={panel}
            inset={inset}
            current={stepIndex}
          >
            <StoryView
              diagram={diagram}
              scenario={scenario}
              current={stepIndex}
              ended={player.ended}
              onSeek={player.playStep}
              collapsed={foldedPhases}
              onTogglePhase={togglePhase}
            />
          </ScrollFrame>
        ) : layout ? (
          <Canvas
            layout={layout}
            maxHeight={maxHeight}
            minHeight={tall ? 460 : 220}
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
            onBackgroundClick={closeDrawer}
            focus={camera}
            onUserMove={stopFollowing}
            panel={panel}
            inset={inset}
            reserve={reserve}
            insetRight={selected && target && !onNodeSelect ? DRAWER_WIDTH + 20 : 0}
            tools={
              <>
                {captions}
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
                  peek={peekOf(target.diagram.nodes[target.id]!, reach)}
                  expanded={expandedSet.has(selected)}
                  onExpand={() => toggleExpand(selected)}
                  onOpen={() => openPath(selected)}
                  onClose={closeDrawer}
                  onSelect={(id) => onPick(`${target.prefix}${id}`)}
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
      </div>

      {scenarios.length > 0 && (
        <PlayerBar
          diagram={diagram}
          scenarios={scenarios}
          scenario={scenario}
          onScenario={selectScenario}
          player={player}
          timeline={timeline}
          started={scenarioActive}
          stepIndex={stepIndex}
          mode={mode}
          onMode={setMode}
          subtitles={subtitles}
          onSubtitles={setSubtitles}
          collapsed={foldedPhases}
          onTogglePhase={togglePhase}
          onFoldPhases={foldPhases}
        />
      )}

      {view.interfaces && (
        <InterfaceTable
          diagram={diagram}
          view={view}
          hover={hover.edge ?? null}
          onHover={onHoverEdge}
          open={ifacesOpen}
          onToggle={() => setIfacesOpen(!ifacesOpen)}
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
const NO_PHASES: ReadonlySet<number> = new Set()

/** The diagram a node holds, and the view to draw of it, for the drawer's picture. */
function peekOf(node: CompiledNode, diagrams: Diagrams) {
  const ref = node.diagram
  const diagram = ref && diagrams[ref.name]
  return ref && diagram ? { diagram, viewId: openingView(diagram, ref) } : undefined
}

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
