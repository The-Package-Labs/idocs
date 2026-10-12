import {
  type CompiledDiagram,
  type CompiledScenario,
  type CompiledStep,
  scopeSvgIds,
} from '@the-package-labs/idocs-core'
import { useId } from 'react'
import { cx, roman } from './util'

interface Props {
  diagram: CompiledDiagram
  scenario: CompiledScenario
  current: number
  onSeek: (index: number) => void
}

const COL = 176
const LEFT = 62
const TOP = 78
const ROW_FLOW = 42
const ROW_SELF = 44
const ROW_PHASE = 30

const STROKE: Record<string, { color: string; dash?: string; width: number }> = {
  request: { color: 'var(--idocs-ink)', width: 1.6 },
  response: { color: 'var(--idocs-ok)', dash: '6 4', width: 1.5 },
  error: { color: 'var(--idocs-bad)', width: 1.7 },
  lookup: { color: 'var(--idocs-muted)', dash: '2 3', width: 1.6 },
  event: { color: 'var(--idocs-warn)', width: 1.6 },
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The scenario as a classic sequence diagram, derived from the same steps the player runs. */
export function SequenceView({ diagram, scenario, current, onSeek }: Props) {
  const uid = useId().replace(/:/g, '')
  const actors: string[] = []
  const see = (id?: string) => {
    if (id && !actors.includes(id)) actors.push(id)
  }
  for (const s of scenario.steps) {
    see(s.from)
    see(s.at)
    see(s.to)
  }
  const x = (id: string) => LEFT + actors.indexOf(id) * COL + COL / 2
  const width = LEFT + actors.length * COL + 24

  type Row =
    | { type: 'phase'; y: number; title: string; caption?: string; index: number }
    | { type: 'step'; y: number; h: number; step: CompiledStep; index: number }
  const rows: Row[] = []
  let y = TOP
  let lastPhase = -1
  const showPhases = scenario.phases.some((p) => p.title)
  scenario.steps.forEach((step, index) => {
    if (showPhases && step.phase !== lastPhase) {
      rows.push({
        type: 'phase',
        y,
        title: scenario.phases[step.phase]!.title,
        caption: scenario.phases[step.phase]!.caption,
        index: step.phase,
      })
      y += ROW_PHASE
      lastPhase = step.phase
    }
    const h = step.type === 'self' ? ROW_SELF : ROW_FLOW
    rows.push({ type: 'step', y, h, step, index })
    y += h
  })
  const height = y + 14

  return (
    <div className="idocs-seq">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Sequence diagram: ${scenario.title}`}
      >
        {/* Dotted separators between the columns, not through the middle of them, so it is clear which
            column a header and the arrows below it belong to. */}
        {Array.from({ length: actors.length + 1 }, (_, k) => (
          <line
            key={`sep${actors[k] ?? 'end'}`}
            className="seq-sep"
            x1={LEFT + k * COL}
            x2={LEFT + k * COL}
            y1={6}
            y2={height - 6}
            stroke="var(--idocs-line)"
            strokeWidth="1.3"
            strokeDasharray="3 5"
          />
        ))}

        {rows.map((r) => {
          if (r.type === 'phase') {
            return (
              <g key={`p${r.index}`}>
                <rect
                  x={6}
                  y={r.y + 2}
                  width={width - 12}
                  height={ROW_PHASE - 6}
                  rx={6}
                  fill="var(--idocs-surface-2)"
                />
                <text className="seq-phase" x={18} y={r.y + 19}>
                  {roman(r.index)} · {r.title}
                  {r.caption ? `  —  ${r.caption}` : ''}
                </text>
              </g>
            )
          }
          const { step: s, y: ry, h } = r
          const stroke = STROKE[s.kind] ?? STROKE.request!
          const planned = s.status === 'planned'
          return (
            <g
              key={s.id}
              className={cx('seq-row', r.index === current && 'is-active')}
              onClick={() => onSeek(r.index)}
            >
              <rect className="seq-band" x={0} y={ry} width={width} height={h} />
              <text className="seq-num" x={22} y={ry + h / 2 + 4} textAnchor="middle">
                {s.n}
              </text>
              {s.type === 'self' && s.at ? (
                <>
                  <rect
                    x={x(s.at) - 96}
                    y={ry + 7}
                    width={192}
                    height={28}
                    rx={6}
                    fill="var(--idocs-accent-soft)"
                    stroke={stroke.color}
                    strokeWidth="1.2"
                    strokeDasharray={planned ? '5 4' : undefined}
                  />
                  <text
                    className="seq-label"
                    x={x(s.at)}
                    y={ry + 25}
                    textAnchor="middle"
                    style={{ stroke: 'none' }}
                  >
                    {clip(s.label, 30)}
                  </text>
                </>
              ) : (
                s.from &&
                s.to && (
                  <Arrow
                    step={s}
                    x1={x(s.from)}
                    x2={x(s.to)}
                    y={ry}
                    stroke={stroke}
                    planned={planned}
                  />
                )
              )}
            </g>
          )
        })}

        {actors.map((id) => {
          const n = diagram.nodes[id]!
          const bx = x(id) - (COL - 24) / 2
          return (
            <g key={`h${id}`}>
              <title>{n.title}</title>
              <rect
                x={bx}
                y={8}
                width={COL - 24}
                height={50}
                rx={8}
                fill="var(--idocs-surface)"
                stroke="var(--idocs-line)"
                strokeWidth="1.3"
              />
              {n.icon && (
                <svg
                  x={bx + 9}
                  y={19}
                  width={20}
                  height={20}
                  viewBox={n.icon.viewBox}
                  style={n.icon.mono ? { color: 'var(--idocs-muted)' } : undefined}
                  dangerouslySetInnerHTML={{ __html: scopeSvgIds(n.icon.body, `s${uid}-${id}`) }}
                />
              )}
              <text className="seq-title" x={bx + (n.icon ? 36 : 12)} y={29}>
                {clip(n.title, n.icon ? 16 : 20)}
              </text>
              {n.sub && (
                <text className="seq-sub" x={bx + (n.icon ? 36 : 12)} y={45}>
                  {clip(n.sub, n.icon ? 19 : 24)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Arrow({
  step,
  x1,
  x2,
  y,
  stroke,
  planned,
}: {
  step: CompiledStep
  x1: number
  x2: number
  y: number
  stroke: { color: string; dash?: string; width: number }
  planned: boolean
}) {
  const dir = Math.sign(x2 - x1) || 1
  const ay = y + 31
  return (
    <>
      <line
        x1={x1}
        y1={ay}
        x2={x2 - dir * 2}
        y2={ay}
        stroke={stroke.color}
        strokeWidth={stroke.width}
        strokeDasharray={planned ? '5 4' : stroke.dash}
        opacity={planned ? 0.75 : 1}
      />
      <polygon
        points={`${x2},${ay} ${x2 - dir * 9},${ay - 4.5} ${x2 - dir * 9},${ay + 4.5}`}
        fill={stroke.color}
      />
      {step.label && (
        <text className="seq-label" x={(x1 + x2) / 2} y={y + 22} textAnchor="middle">
          {step.label}
        </text>
      )}
    </>
  )
}
