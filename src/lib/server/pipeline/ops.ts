// Operator-facing bookkeeping: the run log, DB health gate, low-yield report.
import { appendFileSync } from 'node:fs'
import type { Json } from '../../database.types'
import { supabaseAdmin } from '../supabase'
import { LOW_YIELD } from '../config'
import type { RunStats } from './stats'

// Feeds that fetch fine but almost never yield an accepted article. Fetch health
// cannot see these. Reported in stats every run; the workflow files a
// feed-health issue from the step output (at most one open issue, commented on).
export async function reportLowYield(stats: RunStats): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin.rpc('source_yield', {
      p_days: LOW_YIELD.days, p_min_items: LOW_YIELD.minItems, p_max_pct: LOW_YIELD.maxPct,
    })
    if (error) throw new Error(JSON.stringify(error))
    const rows = data ?? []
    stats.low_yield_sources = rows.map((r) => ({ name: r.r_name, accepted: r.r_accepted, rejected: r.r_rejected }))
    if (rows.length > 0 && process.env.GITHUB_OUTPUT) {
      const lines = rows.map((r) => `${r.r_name}: ${r.r_accepted} accepted / ${r.r_rejected} rejected in ${LOW_YIELD.days}d (${Number(r.r_pct).toFixed(1)}%)`)
      appendFileSync(process.env.GITHUB_OUTPUT, `low_yield_sources<<EOF\n${lines.join('\n')}\nEOF\n`)
    }
  } catch (err) {
    console.error('[pipeline] low-yield report failed (non-fatal):', err)
  }
}

export async function recordRun(startedAt: Date, stats: RunStats, error: unknown): Promise<void> {
  // Best-effort: a run-log failure must never fail the run (and a total
  // Supabase-connectivity fatal can't record itself — accepted).
  try {
    const { error: insertError } = await supabaseAdmin.from('pipeline_runs').insert({
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      error: error ? String(error).slice(0, 1000) : null,
      // RunStats is assembled from JSON-able values only; the generated column
      // type is the recursive Json, which a Record<string, unknown> cannot prove.
      stats: stats as Json,
    })
    if (insertError) console.error('[pipeline] run-log write failed:', insertError)
  } catch (err) {
    console.error('[pipeline] run-log write failed:', err)
  }
}

// Operator health gate, read once per run. ops_health() returns DB size + the
// last retention-cron outcome. Runs at the END of a run: a tripped threshold
// must ALERT (fail the run → GitHub issue), never halt ingestion (already done).
export async function checkOpsHealth(stats: RunStats): Promise<void> {
  let health: Record<string, unknown> | null = null
  try {
    const { data } = await supabaseAdmin.rpc('ops_health')
    health = (data as Record<string, unknown>) ?? null
  } catch (err) {
    console.error('[pipeline] ops_health check failed (non-fatal):', err)
  }
  if (!health) return
  stats.db = health
  const sizeMb = Number(health.db_size_mb) || 0
  const lastAt = health.retention_last_at ? new Date(health.retention_last_at as string).getTime() : 0
  if (!lastAt || Date.now() - lastAt > 48 * 3600_000) {
    console.error(`[pipeline] WARNING: retention has not succeeded in >48h (last: ${health.retention_last_at ?? 'never'})`)
  }
  if (sizeMb > 400) console.error(`[pipeline] WARNING: DB size ${sizeMb}MB (free-tier cap is 500MB)`)
  if (sizeMb > 450) {
    throw new Error(`DB size ${sizeMb}MB exceeds the 450MB ceiling (free tier is 500MB) — prune or upgrade`)
  }
}

// Did the last recorded run also lose most of its Jev calls? Read from
// pipeline_runs.stats so the guard has memory across runs. Unknown (no prior
// row, query error) reads as false: the guard errs toward not alerting on one
// run's evidence, which is the whole point of consulting it.
export async function previousRunJevDown(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('pipeline_runs')
    .select('stats')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return false
  return (data.stats as Record<string, unknown> | null)?.cls_all_failed === true
}
