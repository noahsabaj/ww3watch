// WW3Watch ingestion pipeline — runs on a schedule via GitHub Actions
// (.github/workflows/pipeline.yml), or against local staging with: npm run staging:pipeline
//
// This file is only the entry point. The run is src/lib/server/pipeline/run.ts
// (fetch → dedupe → classify → persist → cluster → annotate → trending → ops);
// each stage is its own module next to it, and every tunable number is in
// src/lib/server/config.ts. Every run writes one pipeline_runs row (stats +
// error), including the thresholds it ran with.
import { jevEnabled } from '../src/lib/server/jev-classify'
import { run } from '../src/lib/server/pipeline/run'
import { recordRun } from '../src/lib/server/pipeline/ops'
import type { RunStats } from '../src/lib/server/pipeline/stats'

async function main() {
  if (!jevEnabled()) throw new Error('Missing required environment variable: TYPESAFE_API_KEY (relevance, signals, trending and story pairs all run on Jev)')
  const startedAt = new Date()
  const stats: RunStats = {}
  let runError: unknown = null
  try {
    const release = await reserveClassification(JEV_MODEL, '')
    await release(0)
    await run(stats)
    assertBudgetHealthy()
  } catch (err) {
    runError = err
    throw err
  } finally {
    // Exactly one run-log row per run — including the no-new-articles early
    // return and fatal paths (finally runs before the rethrow propagates).
    await recordRun(startedAt, stats, runError)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[pipeline] fatal:', err)
    process.exit(1)
  })
import { reserveClassification, assertBudgetHealthy } from '../src/lib/server/ai-budget'
import { JEV_MODEL } from '../src/lib/server/jev'
