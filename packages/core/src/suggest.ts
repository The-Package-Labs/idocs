// Typo suggestions for ids and names in diagnostics. Pure, so every entry can use it.

export function didYouMean(word: string, options: readonly string[]): string | undefined {
  let best: string | undefined
  let bestDist = Math.max(2, Math.floor(word.length / 3)) + 1
  for (const o of options) {
    const d = levenshtein(word.toLowerCase(), o.toLowerCase())
    if (d < bestDist) {
      best = o
      bestDist = d
    }
  }
  return best ? `Did you mean "${best}"?` : undefined
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]!
}
