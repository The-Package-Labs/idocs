import { DiagramView } from '@the-package-labs/idocs-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Problem, ToWebview } from '../src/preview/protocol'
import { ProblemList } from './ProblemList'
import { Toolbar } from './Toolbar'
import { vscode } from './vscode'

type Diagram = Extract<ToWebview, { type: 'diagram' }>

type State = { kind: 'empty'; message: string } | { kind: 'diagram'; message: Diagram }

/** The canvas may use the window, less the controls above and below it. */
function canvasHeight(): number {
  return Math.max(360, window.innerHeight - 230)
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'empty', message: 'Loading…' })
  const [highlight, setHighlight] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [showProblems, setShowProblems] = useState(false)
  const [height, setHeight] = useState(canvasHeight)
  const folderRef = useRef<string | null>(null)

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToWebview>) => {
      const m = event.data
      switch (m.type) {
        case 'diagram':
          // Whatever was outlined belonged to the diagram that was on screen before. Decide now: a
          // state updater would run after the ref below has already changed.
          if (folderRef.current !== m.folder) setHighlight(null)
          folderRef.current = m.folder
          setState({ kind: 'diagram', message: m })
          setLocked(m.locked)
          // Restores the panel after VS Code restarts.
          vscode.setState({ folder: m.folder, locked: m.locked })
          return
        case 'select':
          setHighlight(m.node)
          return
        case 'lock':
          setLocked(m.locked)
          return
        case 'empty':
          setState({ kind: 'empty', message: m.message })
          return
      }
    }
    const onResize = () => setHeight(canvasHeight())
    window.addEventListener('message', onMessage)
    window.addEventListener('resize', onResize)
    vscode.postMessage({ type: 'ready' })
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const reveal = useCallback((problem: Problem) => {
    vscode.postMessage({
      type: 'reveal-problem',
      file: problem.file,
      line: problem.line,
      col: problem.col,
    })
  }, [])
  const openNode = useCallback((id: string) => vscode.postMessage({ type: 'reveal-node', id }), [])

  if (state.kind === 'empty') {
    return (
      <div className="vsc-empty" role="status">
        <p>{state.message}</p>
      </div>
    )
  }

  const { diagram, problems, stale, name } = state.message
  const errors = problems.filter((p) => p.severity === 'error').length
  // With nothing to draw, the problems are the page.
  const listOpen = showProblems || (!diagram && problems.length > 0)

  return (
    <div className="vsc-root">
      <Toolbar
        title={diagram?.title ?? name}
        name={name}
        problems={problems}
        stale={stale && !!diagram}
        locked={locked}
        open={listOpen}
        onToggleProblems={() => setShowProblems((v) => !v)}
        onToggleLock={() => vscode.postMessage({ type: 'toggle-lock' })}
        onRefresh={() => vscode.postMessage({ type: 'refresh' })}
      />
      {listOpen && <ProblemList problems={problems} onReveal={reveal} />}
      <main className="vsc-body">
        {diagram ? (
          <DiagramView
            key={name}
            diagram={diagram}
            hash={false}
            showTitle
            showDescription
            maxHeight={height}
            highlightNode={highlight}
            onNodeOpen={openNode}
          />
        ) : (
          <div className="vsc-empty" role="status">
            <p>
              {errors
                ? 'This diagram has errors, so there is nothing to draw yet.'
                : 'Nothing to show yet.'}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
