import { MAJOR_SEVERITY } from '../signals'

// Nothing reviews Jev's verdicts any more, and every threshold in this repo
// (JEV_THRESHOLD, MAJOR_SEVERITY, the pair band) is tuned to ONE model version's
// probabilities — which is why JEV_MODEL is pinned. When that version is retired,
// this is the check that runs BEFORE the pin moves: the same frozen headlines,
// asked again, compared with what the pinned model said.

export interface RegressionRow {
  title: string
  lang: string
  relevant: number
  severity: number | null
}

export interface RegressionReport {
  n: number
  /** Articles whose accept/reject verdict changed at the relevance threshold. */
  relevanceFlips: number
  /** Articles that crossed the "major" cut in either direction. */
  majorFlips: number
  meanAbsRelevantDelta: number
  ok: boolean
}

export const LIMITS = { relevanceFlipRate: 0.03, majorFlipRate: 0.05 }

export function compareRuns(baseline: RegressionRow[], current: RegressionRow[], relevanceThreshold: number): RegressionReport {
  const byTitle = new Map(current.map((r) => [r.title, r]))
  let n = 0, relevanceFlips = 0, majorFlips = 0, absDelta = 0
  for (const b of baseline) {
    const c = byTitle.get(b.title)
    if (!c) continue
    n++
    if (b.relevant >= relevanceThreshold !== c.relevant >= relevanceThreshold) relevanceFlips++
    if ((b.severity ?? 0) >= MAJOR_SEVERITY !== (c.severity ?? 0) >= MAJOR_SEVERITY) majorFlips++
    absDelta += Math.abs(b.relevant - c.relevant)
  }
  return {
    n,
    relevanceFlips,
    majorFlips,
    meanAbsRelevantDelta: n ? absDelta / n : 0,
    // A comparison that could not match most of the baseline proves nothing.
    ok: n >= baseline.length * 0.9 && relevanceFlips <= n * LIMITS.relevanceFlipRate && majorFlips <= n * LIMITS.majorFlipRate,
  }
}
