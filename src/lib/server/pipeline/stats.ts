// What one run records in pipeline_runs.stats. Every key is optional: stages add
// what they did, and a run that died early still writes whatever it had.
export interface RunStats {
  /** Thresholds and caps this run used — so "what produced these numbers?" has an answer. */
  config?: Record<string, unknown>
  timings?: Record<string, number>
  // fetch
  items?: number
  unique?: number
  new?: number
  feeds_ok?: number
  feeds_failed?: number
  feeds_direct?: number
  feeds_proxy?: number
  fail_kinds?: Record<string, number>
  dates_clamped?: number
  sources_disabled?: string[]
  low_yield_sources?: Array<{ name: string; accepted: number; rejected: number }>
  // classify
  cls_head?: Record<string, unknown>
  cls_jev?: Record<string, unknown>
  cls_all_failed?: boolean
  classified?: number
  deferred?: number
  relevant?: number
  rejected?: number
  inserted?: number
  stale_written_off?: number
  verdicts_recorded?: number
  // clustering
  embedded?: number
  embed_skipped?: number
  clusters_assigned?: number
  clusters_new?: number
  cluster_error?: string
  reps_reelected?: number
  stories_merged?: number
  merge_pairs_judged?: number
  merge_error?: string
  pairs_judged?: number
  pairs_same?: number
  pairs_different?: number
  pairs_unsure?: number
  pairs_failed?: number
  pairs_error?: string
  // signals
  signals_applied?: number
  signals_failed?: number
  signals_tokens?: number
  signals_purged?: number
  signals_error?: string
  // images
  images_filled?: number
  images_none?: number
  images_failed?: number
  images_error?: string
  // finalize
  trending?: string
  db?: Record<string, unknown>
  total_ms?: number
}

/** Keys whose value is a running count. */
export type CounterKey = {
  [K in keyof RunStats]-?: NonNullable<RunStats[K]> extends number ? K : never
}[keyof RunStats]

/** Add to a counter. Stages can run twice per run, so counters accumulate. */
export function bump(stats: RunStats, key: CounterKey, n: number): void {
  stats[key] = (stats[key] ?? 0) + n
}

/** Run a stage, recording its wall-clock under stats.timings[stage]. */
export async function timed<T>(stats: RunStats, stage: string, fn: () => Promise<T>): Promise<T> {
  const timings = (stats.timings ??= {})
  const t0 = Date.now()
  try {
    return await fn()
  } finally {
    timings[stage] = Date.now() - t0
  }
}
