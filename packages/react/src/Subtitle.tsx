import type { CompiledDiagram, CompiledStep } from '@the-package-labs/idocs-core'
import { cx } from './util'

interface Props {
  diagram: CompiledDiagram
  step: CompiledStep
  total: number
}

/**
 * What is happening, in words, as a scenario plays: the step, who talks to whom, and the note the
 * author wrote for it. Like the subtitles of a video, it follows the action and says nothing the
 * step list does not, so it is for looking at and is hidden from screen readers.
 */
export function Subtitle({ diagram, step, total }: Props) {
  const name = (id?: string) => (id ? (diagram.nodes[id]?.title ?? id) : '')
  const route = step.type === 'self' ? name(step.at) : `${name(step.from)} → ${name(step.to)}`
  return (
    <div className={cx('idocs-subtitle', `kind-${step.kind}`)} aria-hidden="true">
      <div className="idocs-subtitle-main">
        <span className="idocs-subtitle-n">
          {step.n}/{total}
        </span>
        <b>{step.title ?? step.label}</b>
      </div>
      <div className="idocs-subtitle-route">
        {route}
        {step.label && step.title && step.label !== step.title ? ` · ${step.label}` : ''}
      </div>
      {step.noteHtml && (
        <div className="idocs-subtitle-note" dangerouslySetInnerHTML={{ __html: step.noteHtml }} />
      )}
    </div>
  )
}
