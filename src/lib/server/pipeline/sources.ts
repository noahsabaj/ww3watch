// The feed roster (sources table) and the health written back to it every run.
import { appendFileSync } from 'node:fs'
import { FEED_ERROR_KINDS, type FeedFetchResult, type FeedErrorKind } from '../rss'
import type { Feed } from '../../types'
import type { TablesInsert } from '../../database.types'
import { supabaseAdmin } from '../supabase'
import { AUTO_DISABLE_AFTER, UPSERT_BATCH } from '../config'

// A sources-table row: the fetchable Feed shape plus health bookkeeping.
export type SourceRow = Feed & {
  id: string
  enabled: boolean
  consecutive_failures: number
}

// The roster lives in the DB (sources table). A failed/empty roster query must
// FAIL the run loudly — a silent zero-feed "success" would record error=null
// and reset the freshness dead-man's switch.
export async function loadSources(): Promise<SourceRow[]> {
  const { data, error } = await supabaseAdmin
    .from('sources')
    .select('*')
    .eq('enabled', true)
    // Deterministic order ⇒ deterministic guid-dedupe attribution for items
    // cross-posted to multiple feeds.
    .order('name')
  if (error) throw new Error(`sources roster query failed: ${JSON.stringify(error)}`)
  if (!data?.length) throw new Error('sources roster is empty — refusing to run')
  return data as SourceRow[]
}

// Write per-source health back after the fetch pass. Two homogeneous upserts
// (PostgREST requires uniform payload keys): successes reset the failure
// counter; failures increment it and record the kind/detail. A source crossing
// AUTO_DISABLE_AFTER consecutive failures is switched off here; its name is
// returned so the run can report it. Best-effort — health bookkeeping must
// never fail the run.
export async function updateSourceHealth(results: FeedFetchResult[]): Promise<string[]> {
  const now = new Date().toISOString()
  const base = (s: SourceRow) => ({
    id: s.id,
    url: s.url,
    name: s.name,
    region: s.region,
    lang: s.lang,
    enabled: s.enabled,
    updated_at: now,
  })
  const ok = results
    .filter((r) => !r.error)
    .map((r) => ({
      ...base(r.feed as SourceRow),
      last_ok_at: now,
      last_via: r.via,
      consecutive_failures: 0,
      last_error_kind: null,
      last_error: null,
    }))
  const disabled: string[] = []
  const failed = results
    .filter((r) => r.error)
    .map((r) => {
      const feed = r.feed as SourceRow
      const consecutive = (feed.consecutive_failures ?? 0) + 1
      const stillEnabled = consecutive < AUTO_DISABLE_AFTER
      if (!stillEnabled) disabled.push(`${feed.name} (${r.error!.kind}: ${r.error!.detail.slice(0, 80)})`)
      return {
        ...base(feed),
        enabled: stillEnabled,
        consecutive_failures: consecutive,
        last_error_kind: r.error!.kind,
        // Feed error details can embed binary/HTML response snippets — Postgres
        // text rejects NUL (and friends); one bad row poisons the whole batch.
        last_error: r.error!.detail.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 300),
      }
    })
  const batches: TablesInsert<'sources'>[][] = [ok, failed]
  for (const rows of batches) {
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const { error } = await supabaseAdmin
        .from('sources')
        .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: 'id' })
      if (error) console.error('[pipeline] source health write failed:', error)
    }
  }
  if (disabled.length > 0) {
    console.warn(`[pipeline] auto-disabled ${disabled.length} source(s) after ${AUTO_DISABLE_AFTER} consecutive failures:`)
    for (const d of disabled) console.warn(`  - ${d}`)
    // Hand the list to the workflow so it can file the feed-health issue.
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `disabled_sources<<EOF\n${disabled.join('\n')}\nEOF\n`)
    }
  }
  return disabled
}

export function logFeedSummary(results: FeedFetchResult[]) {
  const ok = results.filter((r) => !r.error)
  const direct = ok.filter((r) => r.via === 'direct').length
  const proxy = ok.filter((r) => r.via === 'proxy').length
  const failed = results.filter((r) => r.error)
  // Build the tally from the canonical kind list so it can't drift when a kind
  // is added (e.g. 'blocked').
  const byKind = Object.fromEntries(FEED_ERROR_KINDS.map((k) => [k, 0])) as Record<FeedErrorKind, number>
  for (const r of failed) byKind[r.error!.kind]++

  const datesClamped = results.reduce((sum, r) => sum + (r.clamped ?? 0), 0)

  const kindSummary = FEED_ERROR_KINDS.map((k) => `${k}=${byKind[k]}`).join(' ')
  console.log(
    `[pipeline] feeds ok ${ok.length}/${results.length} (direct ${direct}, proxy ${proxy}) | failed ${failed.length}: ${kindSummary}`,
  )
  for (const r of failed) {
    console.log(`[feed-fail] ${r.feed.name} [${r.feed.region}] ${r.error!.kind}: ${r.error!.detail}`)
  }
  if (datesClamped > 0) console.log(`[pipeline] clamped ${datesClamped} out-of-range pubDate(s) to null`)

  return {
    feeds_ok: ok.length,
    feeds_direct: direct,
    feeds_proxy: proxy,
    feeds_failed: failed.length,
    fail_kinds: byKind,
    dates_clamped: datesClamped,
  }
}
