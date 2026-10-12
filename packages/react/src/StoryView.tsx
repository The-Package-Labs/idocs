import {
  buildStory,
  type CompiledDiagram,
  type CompiledScenario,
  roundedPath,
  STEP_KIND_COLORS,
  type StepKind,
  type StoryBox,
} from '@the-package-labs/idocs-core'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { colorVar, cx, roman } from './util'

interface Props {
  diagram: CompiledDiagram
  scenario: CompiledScenario
  /** Index of the step in progress, -1 before the start. */
  current: number
  ended: boolean
  onSeek: (index: number) => void
}

interface Geometry {
  w: number
  h: number
  lifelines: { x: number; y1: number; y2: number }[]
  links: { key: string; d: string; kind: StepKind; style: 'flow' | 'lookup'; step: number }[]
}

/** Let long paths and identifiers wrap after a slash, dot or underscore, not in the middle of a word. */
const breakable = (text: string) => text.replace(/([/_.])(?=\w)/g, '$1\u200b')

const LEGEND: Record<string, string> = {
  request: 'The request going out',
  response: 'The answer coming back',
  error: 'Something goes wrong',
  event: 'An event it sends out',
}

/** A scenario as swimlanes: lanes across, steps down, phases as bands. See core/story.ts. */
export function StoryView({ diagram, scenario, current, ended, onSeek }: Props) {
  const uid = useId().replace(/:/g, '')
  const story = useMemo(() => buildStory(diagram, scenario), [diagram, scenario])
  const gridRef = useRef<HTMLDivElement>(null)
  const boxEls = useRef(new Map<string, HTMLElement>()).current
  const headEls = useRef<(HTMLElement | null)[]>([])
  const [geo, setGeo] = useState<Geometry | null>(null)

  // Grid rows: a header, then for each phase a little padding, its boxes, and padding again.
  const layout = useMemo(() => {
    const rowOf = new Map<number, number>()
    const bands: {
      index: number
      from: number
      to: number
      title: string
      caption?: string
      first: number
      last: number
    }[] = []
    const template: string[] = ['auto']
    let cursor = 2
    story.phases.forEach((phase, i) => {
      const from = cursor++
      template.push('12px')
      for (let r = phase.rowStart; r <= phase.rowEnd; r++) {
        rowOf.set(r, cursor++)
        template.push('auto')
      }
      const to = cursor++
      template.push('12px')
      bands.push({
        index: i,
        from,
        to,
        title: phase.title,
        caption: phase.caption,
        first: from,
        last: to,
      })
    })
    return { rowOf, bands, template: template.join(' ') }
  }, [story])

  const cells = useMemo(() => {
    const map = new Map<string, StoryBox[]>()
    for (const box of story.boxes) {
      const key = `${box.row}:${box.lane}`
      map.set(key, [...(map.get(key) ?? []), box])
    }
    return [...map.entries()].map(([key, boxes]) => {
      const [row, lane] = key.split(':').map(Number) as [number, number]
      return { key, row, lane, boxes }
    })
  }, [story])

  const measure = useCallback(() => {
    const grid = gridRef.current
    if (!grid) return
    const base = grid.getBoundingClientRect()
    const rect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }
    }
    // Separators run between the lanes, and at the two outer edges, so each column is closed on
    // both sides and it is clear which lane a box falls in. Through the middle they would look like
    // a lane's own line, and would run behind its boxes.
    const heads = headEls.current.flatMap((el) => (el ? [rect(el)] : []))
    const lifelines: Geometry['lifelines'] = []
    if (heads.length) {
      const gap = heads.length > 1 ? Math.max(8, heads[1]!.x - (heads[0]!.x + heads[0]!.w)) : 12
      const edges = [
        heads[0]!.x - gap / 2,
        ...heads.slice(1).map((h, i) => (heads[i]!.x + heads[i]!.w + h.x) / 2),
        heads[heads.length - 1]!.x + heads[heads.length - 1]!.w + gap / 2,
      ]
      for (const x of edges) lifelines.push({ x, y1: heads[0]!.y, y2: base.height - 6 })
    }
    // Where each story row starts and ends, counting lookup boxes stacked beside the main one, so
    // connectors turn in the gap between rows and never behind a box.
    const rowTop = new Map<number, number>()
    const rowBottom = new Map<number, number>()
    const rowOfBox = new Map(story.boxes.map((b) => [b.id, b.row]))
    for (const box of story.boxes) {
      const el = boxEls.get(box.id)
      if (!el) continue
      const r = rect(el)
      rowTop.set(box.row, Math.min(rowTop.get(box.row) ?? Number.POSITIVE_INFINITY, r.y))
      rowBottom.set(box.row, Math.max(rowBottom.get(box.row) ?? 0, r.y + r.h))
    }
    const links: Geometry['links'] = []
    for (const link of story.links) {
      const fromEl = boxEls.get(link.from)
      const toEl = boxEls.get(link.to)
      if (!fromEl || !toEl) continue
      const a = rect(fromEl)
      const b = rect(toEl)
      let points: { x: number; y: number }[]
      if (link.style === 'lookup') {
        const ay = a.y + a.h / 2
        const by = b.y + b.h / 2
        const right = b.x >= a.x + a.w
        const ax = right ? a.x + a.w : a.x
        const bx = right ? b.x : b.x + b.w
        // Boxes that overlap vertically get one straight arrow through the overlap. A lookup stacked
        // below the first is not level with the asker, so it steps down in the gap between them.
        const top = Math.max(a.y, b.y)
        const bottom = Math.min(a.y + a.h, b.y + b.h)
        points =
          bottom - top >= 14
            ? [
                { x: ax, y: (top + bottom) / 2 },
                { x: bx, y: (top + bottom) / 2 },
              ]
            : [
                { x: ax, y: ay },
                { x: (ax + bx) / 2, y: ay },
                { x: (ax + bx) / 2, y: by },
                { x: bx, y: by },
              ]
      } else {
        const ax = a.x + a.w / 2
        const bx = b.x + b.w / 2
        const y0 = a.y + a.h
        const y1 = b.y
        const turnFrom = rowBottom.get(rowOfBox.get(link.from) ?? -1) ?? y0
        const turnTo = rowTop.get(rowOfBox.get(link.to) ?? -1) ?? y1
        const mid = Math.max(y0 + 4, Math.min((turnFrom + turnTo) / 2, y1 - 4))
        points =
          Math.abs(ax - bx) < 2
            ? [
                { x: ax, y: y0 },
                { x: bx, y: y1 },
              ]
            : [
                { x: ax, y: y0 },
                { x: ax, y: mid },
                { x: bx, y: mid },
                { x: bx, y: y1 },
              ]
      }
      links.push({
        key: `${link.from}-${link.to}`,
        d: roundedPath(points, 7),
        kind: link.kind,
        style: link.style,
        step: link.step,
      })
    }
    setGeo({ w: base.width, h: base.height, lifelines, links })
  }, [story, boxEls])

  // Connectors depend on where the browser put the boxes, so measure after layout, on resize and
  // once web fonts have arrived (text wraps differently).
  useLayoutEffect(() => {
    measure()
    const grid = gridRef.current
    if (!grid) return
    const ro = new ResizeObserver(measure)
    ro.observe(grid)
    void document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [measure])

  const kinds = useMemo(() => [...new Set(story.links.map((l) => l.kind))], [story])
  const playing = current >= 0 || ended

  const isActive = (box: StoryBox) => box.steps.includes(current)
  const isDone = (box: StoryBox) => ended || box.steps.every((s) => s < current)

  return (
    <div className="idocs-story">
      <div className="idocs-legend" role="group" aria-label="Legend">
        {['request', 'response', 'error', 'event']
          .filter((k) => kinds.includes(k as StepKind))
          .map((k) => (
            <span key={k}>
              <svg viewBox="0 0 44 12" aria-hidden="true">
                <line
                  x1="2"
                  y1="6"
                  x2="34"
                  y2="6"
                  stroke={colorVar(STEP_KIND_COLORS[k]!)}
                  strokeWidth="2"
                />
                <path d="M32 2L41 6L32 10z" fill={colorVar(STEP_KIND_COLORS[k]!)} />
              </svg>
              {LEGEND[k]}
            </span>
          ))}
        {kinds.includes('lookup') && (
          <span>
            <svg viewBox="0 0 44 12" aria-hidden="true">
              <line
                x1="2"
                y1="6"
                x2="42"
                y2="6"
                stroke="var(--idocs-ink)"
                strokeWidth="1.6"
                strokeDasharray="2 3"
              />
            </svg>
            A lookup in a data store
          </span>
        )}
      </div>

      <div className="idocs-story-scroll">
        <div
          ref={gridRef}
          className="idocs-story-grid"
          style={
            {
              '--lanes': story.lanes.length,
              gridTemplateRows: layout.template,
            } as React.CSSProperties
          }
        >
          {layout.bands.map((band) => (
            <div key={`band-${band.index}`} style={{ display: 'contents' }}>
              <div
                className={cx('idocs-phase-band', band.index % 2 === 0 ? 'is-odd' : 'is-even')}
                style={{ gridColumn: '1 / -1', gridRow: `${band.from} / ${band.to + 1}` }}
              />
              <div
                className="idocs-phase-label"
                style={{ gridColumn: 1, gridRow: `${band.from + 1} / ${band.to}` }}
              >
                <span className="idocs-phase-roman">{roman(band.index)}</span>
                <span className="idocs-phase-name">{band.title}</span>
                {band.caption && <span className="idocs-phase-cap">{band.caption}</span>}
              </div>
            </div>
          ))}

          {story.lanes.map((lane) => (
            <div
              key={`lane-${lane.index}`}
              ref={(el) => {
                headEls.current[lane.index] = el
              }}
              className="idocs-lane-head"
              style={{ gridColumn: lane.index + 2, gridRow: 1 }}
            >
              {lane.icons.length > 0 && (
                <span className="idocs-lane-icons">
                  {lane.icons.map((icon, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: two nodes in a lane can share an icon
                      key={`${i}-${icon.set}-${icon.name}`}
                      className={cx('idocs-lane-icon', icon.mono ? 'is-mono' : 'is-brand')}
                    >
                      <Icon icon={icon} />
                    </span>
                  ))}
                </span>
              )}
              <span className="idocs-lane-title">{lane.title}</span>
              {lane.sub && <span className="idocs-lane-sub">{lane.sub}</span>}
            </div>
          ))}

          {cells.map((cell) => (
            <div
              key={cell.key}
              className="idocs-story-cell"
              style={{ gridColumn: cell.lane + 2, gridRow: layout.rowOf.get(cell.row) }}
            >
              {cell.boxes.map((box) => (
                <div
                  key={box.id}
                  ref={(el) => {
                    if (el) boxEls.set(box.id, el)
                    else boxEls.delete(box.id)
                  }}
                  className={cx(
                    'idocs-sbox',
                    `role-${box.role}`,
                    `kind-${box.kind}`,
                    `st-${box.status}`,
                    isActive(box) && 'is-active',
                    playing && isDone(box) && !isActive(box) && 'is-done',
                  )}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSeek(box.step)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSeek(box.step)
                    }
                  }}
                >
                  <div className="idocs-sbox-title">
                    {box.icon && <Icon icon={box.icon} className="idocs-sbox-icon" />}
                    {box.n !== undefined && <span className="idocs-sbox-n">{box.n} ·</span>}
                    <span>{breakable(box.title)}</span>
                  </div>
                  {box.detail && (
                    <div className="idocs-sbox-detail">
                      {box.detail.split('\n').map((line) => (
                        <div key={line}>{breakable(line)}</div>
                      ))}
                    </div>
                  )}
                  {box.status !== 'built' && (
                    <span className={cx('idocs-pill', `st-${box.status}`)}>{box.status}</span>
                  )}
                </div>
              ))}
            </div>
          ))}

          {geo && (
            <svg className="idocs-story-links" width={geo.w} height={geo.h} aria-hidden="true">
              <defs>
                {kinds.map((k) => (
                  <marker
                    key={k}
                    id={`${uid}-sa-${k}`}
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    markerUnits="userSpaceOnUse"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M0 0L10 5L0 10z"
                      fill={colorVar(k === 'lookup' ? 'ink' : (STEP_KIND_COLORS[k] ?? 'ink'))}
                    />
                  </marker>
                ))}
              </defs>
              {geo.lifelines.map((l) => (
                <line key={l.x} className="idocs-lane-sep" x1={l.x} x2={l.x} y1={l.y1} y2={l.y2} />
              ))}
              {geo.links.map((l) => {
                const color = colorVar(
                  l.style === 'lookup' ? 'ink' : (STEP_KIND_COLORS[l.kind] ?? 'ink'),
                )
                const lit = !playing || ended || l.step <= current
                return (
                  <path
                    key={l.key}
                    className={cx(
                      'idocs-slink',
                      l.style === 'lookup' && 'is-lookup',
                      !lit && 'is-future',
                    )}
                    d={l.d}
                    stroke={color}
                    markerEnd={`url(#${uid}-sa-${l.style === 'lookup' ? 'lookup' : l.kind})`}
                    markerStart={l.style === 'lookup' ? `url(#${uid}-sa-lookup)` : undefined}
                  />
                )
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
