// The feed roster (sources table) and the health written back to it every run.
import { appendFileSync } from 'node:fs'
import { FEED_ERROR_KINDS, type FeedFetchResult, type FeedErrorKind } from '../rss'
import type { Feed } from '../../types'
import { supabaseAdmin } from '../supabase'
import { AUTO_DISABLE_AFTER, UPSERT_BATCH } from '../config'

// A sources-table row: the fetchable Feed shape plus health bookkeeping.
export type SourceRow = Feed & {
  id: string
  enabled: boolean
  consecutive_failures: number
  updated_at: string
  feed_etag?: string | null
  feed_last_modified?: string | null
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

// Optimistic snapshot guards prevent stale fetch results from undoing curation.
// Only the database decides whether a source crossed the disable threshold.
export async function updateSourceHealth(results: FeedFetchResult[]): Promise<string[]> {
  const disabled: string[] = []
  const rows = results.map(r => ({
    id: (r.feed as SourceRow).id,
    url: r.feed.url,
    observed_updated_at: (r.feed as SourceRow).updated_at,
    ok: !r.error,
    via: r.via,
    error_kind: r.error?.kind ?? null,
    error_detail: r.error?.detail.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 300) ?? null,
    // Next run's If-None-Match / If-Modified-Since (rss.ts); a failure keeps the stored pair.
    etag: r.validators?.etag ?? null,
    last_modified: r.validators?.lastModified ?? null,
  }))
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { data, error } = await supabaseAdmin.rpc('record_source_health', {
      p_results: rows.slice(i, i + UPSERT_BATCH), p_disable_after: AUTO_DISABLE_AFTER,
    })
    if (error) {
      // Never retry using an unguarded table upsert.
      console.error('[pipeline] source health write failed:', error)
      continue
    }
    for (const changed of data ?? []) if (changed.disabled) disabled.push(changed.source_name)
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
  const notModified = ok.filter((r) => r.notModified).length
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
    `[pipeline] feeds ok ${ok.length}/${results.length} (direct ${direct}, proxy ${proxy}, unchanged ${notModified}) | failed ${failed.length}: ${kindSummary}`,
  )
  for (const r of failed) {
    console.log(`[feed-fail] ${r.feed.name} [${r.feed.region}] ${r.error!.kind}: ${r.error!.detail}`)
  }
  if (datesClamped > 0) console.log(`[pipeline] ${datesClamped} pubDate(s) out of range (a future one reads as first seen, one over a year old as undated)`)

  return {
    feeds_ok: ok.length,
    feeds_direct: direct,
    feeds_proxy: proxy,
    feeds_not_modified: notModified,
    feeds_failed: failed.length,
    fail_kinds: byKind,
    dates_clamped: datesClamped,
  }
}
