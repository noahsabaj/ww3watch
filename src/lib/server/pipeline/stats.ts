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
  /** Feeds that answered 304 Not Modified to a conditional request. */
  feeds_not_modified?: number
  fail_kinds?: Record<string, number>
  dates_clamped?: number
  sources_disabled?: string[]
  low_yield_sources?: Array<{ name: string; accepted: number; rejected: number }>
  /** Enabled feeds that fetch fine but delivered at most SILENT.maxItems in SILENT.days. */
  silent_sources?: string[]
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
  /** Grouping's "different" verdicts the merge pass then did not ask again (clustering.ts). */
  merge_pairs_remembered?: number
  /** Trending candidates asked, and unchanged ones whose earlier answers were reused (trending-jev.ts). */
  trending_asked?: number
  trending_reused?: number
  merge_error?: string
  pairs_judged?: number
  pairs_same?: number
  pairs_different?: number
  pairs_unsure?: number
  pairs_failed?: number
  pairs_error?: string
  /** Grey-band join verdicts per 0.02 similarity step ("0.80": {same, different, unsure}). */
  pairs_by_sim?: SimTally
  /** Merge-pass verdicts per 0.02 similarity step; "same" counts only merge-grade ones. */
  merge_by_sim?: SimTally
  // signals
  signals_applied?: number
  signals_failed?: number
  signals_tokens?: number
  /** Exact copies (same headline, summary, language) given another article's answers. */
  signals_reused?: number
  signals_purged?: number
  signals_error?: string
  /** The copy lookup failed; every article was asked instead (signals.ts). */
  signals_copy_error?: string
  // images
  images_filled?: number
  images_none?: number
  /** Pages we could not read this run (timeout, 403, DNS): left NULL, retried next run. */
  images_unreadable?: number
  /** Rows not started before the run's deadline. */
  images_deferred?: number
  images_failed?: number
  images_error?: string
  // photo check (photo-check.ts)
  photos_ok?: number
  /** Logos, seals and emblems: never shown. */
  photos_emblem?: number
  /** Rows retired because their picture is on REUSE_MIN+ different stories. */
  photos_reused?: number
  /** Images we could not download this run: left unchecked, retried next run. */
  photos_unreadable?: number
  photos_deferred?: number
  photos_failed?: number
  photos_error?: string
  // sensor evidence (evidence.ts)
  /** Readings stored this run: FIRMS fires hourly, USGS quakes and IODA outages every 15 minutes. */
  sensors_fire?: number
  sensors_quake?: number
  sensors_outage?: number
  sensors_error?: string
  /** Strike stories given a place this run, and ones whose reports named none Jev would pick. */
  stories_located?: number
  stories_unlocated?: number
  evidence_found?: number
  evidence_tokens?: number
  evidence_error?: string
  // finalize
  trending?: string
  db?: Record<string, unknown>
  total_ms?: number
}

export type SimTally = Record<string, { same: number; different: number; unsure: number }>

/** Count one Jev same-event verdict under its similarity step, so the bands can
 *  be moved on evidence (a week of runs, summed from pipeline_runs.stats). */
export function tallyBySim(stats: RunStats, key: 'pairs_by_sim' | 'merge_by_sim', sim: number, verdict: 'same' | 'different' | 'unsure'): void {
  const step = (Math.floor(sim * 50 + 1e-9) / 50).toFixed(2)
  const tally = (stats[key] ??= {})
  const row = (tally[step] ??= { same: 0, different: 0, unsure: 0 })
  row[verdict]++
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
