// Re-ask Jev the frozen headlines in data/jev-regression.json and compare with
// what the pinned model said when the baseline was recorded
// (src/lib/server/jev-regression.ts explains why). Exits 1 past the limits.
//
//   check the pinned model still behaves:  node --import tsx --env-file=.env scripts/jev-regression.ts
//   evaluate a candidate before re-pinning: JEV_MODEL=jev-latest node --import tsx --env-file=.env scripts/jev-regression.ts
//   re-record after re-pinning:             node --import tsx --env-file=.env scripts/jev-regression.ts --record
//   in CI:                                  gh workflow run run-script.yml -f script=scripts/jev-regression.ts
//
// Needs only TYPESAFE_API_KEY. ~300 requests, about a cent.
import { readFileSync, writeFileSync } from 'node:fs'
import { JEV_MODEL } from '../src/lib/server/jev'
import { askSignals } from '../src/lib/server/jev-signals'
import { JEV_THRESHOLD } from '../src/lib/server/jev-classify'
import { compareRuns, LIMITS, type RegressionRow } from '../src/lib/server/jev-regression'

const FILE = 'data/jev-regression.json'
const RECORD = process.argv.includes('--record')
const CONCURRENCY = 16

interface Baseline { model: string; recorded_at: string; rows: RegressionRow[] }

async function ask(rows: Array<{ title: string; lang: string }>): Promise<RegressionRow[]> {
  const out: RegressionRow[] = []
  let next = 0
  let failed = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < rows.length) {
        const r = rows[next++]
        try {
          const s = await askSignals({ title: r.title, summary: null, source_lang: r.lang })
          if (s.jev_relevant === null) throw new Error('no relevance answer')
          out.push({ title: r.title, lang: r.lang, relevant: +s.jev_relevant.toFixed(3), topic: s.topic, severity: s.severity === null ? null : +s.severity.toFixed(3) })
        } catch (err) {
          failed++
          if (failed <= 3) console.error('jev call failed:', String(err).slice(0, 160))
        }
      }
    }),
  )
  if (failed > 0) console.warn(`${failed} of ${rows.length} calls failed`)
  // Stable order so a re-record diffs cleanly.
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

async function main() {
  const baseline = JSON.parse(readFileSync(FILE, 'utf8')) as Baseline
  const current = await ask(baseline.rows)
  if (RECORD) {
    writeFileSync(FILE, JSON.stringify({ model: JEV_MODEL, recorded_at: new Date().toISOString(), rows: current }, null, 1) + '\n')
    return console.log(`recorded ${current.length} rows for ${JEV_MODEL} → ${FILE}`)
  }
  const report = compareRuns(baseline.rows, current, JEV_THRESHOLD)
  console.log(`baseline ${baseline.model} (${baseline.recorded_at.slice(0, 10)}) vs ${JEV_MODEL}`)
  console.log(report)
  console.log(`limits: relevance flips ≤ ${LIMITS.relevanceFlipRate * 100}%, major flips ≤ ${LIMITS.majorFlipRate * 100}%`)
  if (!report.ok) {
    console.error('REGRESSION: thresholds tuned to the baseline model do not carry over — re-tune before moving the pin')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
