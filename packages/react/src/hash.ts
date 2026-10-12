// Deep links live in the URL fragment as `key=value` pairs joined by `&`, so several diagrams on
// one page can each keep their place:
//   #checkout=place-order.3                       a scenario and step of a diagram
//   #shop~=orders/stock                           the nodes opened, level by level, from `shop`
//   #shop/nest-orders=create.2                    the scenario of a diagram opened inside `shop`

export function readHashValue(key: string): string | null {
  if (typeof location === 'undefined') return null
  for (const part of location.hash.slice(1).split('&')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at) === key) return part.slice(at + 1) || null
  }
  return null
}

export function writeHash(key: string, value: string | null) {
  if (typeof location === 'undefined') return
  const parts = location.hash
    .slice(1)
    .split('&')
    .filter((p) => p && !p.startsWith(`${key}=`))
  if (value) parts.push(`${key}=${value}`)
  const hash = parts.length ? `#${parts.join('&')}` : ''
  if (hash !== location.hash)
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
}

export function readScenarioHash(key: string): { scenario: string; step?: number } | null {
  const value = readHashValue(key)
  if (!value) return null
  const [scenario, step] = value.split('.')
  return { scenario: scenario!, step: step ? Number(step) || undefined : undefined }
}

/**
 * Stands in for a scenario when the reader chose the overview of a diagram that opens on one. It
 * cannot be an id, which are letters, digits, `_`, `.` and `-`.
 */
export const OVERVIEW_MARK = '~'

/**
 * What the link says about the scenario: nothing while the reader is where the diagram opens by
 * itself (`opening`), since that is not worth a link, else the scenario and step, or the overview.
 */
export function scenarioHash(
  scenario: string | null,
  step: number,
  opening: string | null,
): string | null {
  if (scenario === opening && step < 0) return null
  if (!scenario) return OVERVIEW_MARK
  return `${scenario}${step >= 0 ? `.${step + 1}` : ''}`
}

/** The key that holds which nodes are open below a root diagram. */
export const trailKey = (root: string) => `${root}~`
