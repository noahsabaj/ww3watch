// WW3Watch ingestion pipeline — runs on a schedule via GitHub Actions
// (.github/workflows/pipeline.yml) or locally with: node --import tsx scripts/run-pipeline.ts
//
// Replaces the old GET /api/cron serverless route. Reuses the same logic from
// src/lib/server/*, which now reads config from process.env (see env.ts).
//
// Pipeline: fetch all feeds -> de-dup (within run + against DB+rejects) ->
// classify only NEW articles -> upsert + record rejects -> embed titles +
// assign clusters (multilingual embeddings, assign_clusters_by_embedding RPC)
// -> recompute trending. Every run writes one pipeline_runs row (stats jsonb
// + error) for dashboard observability.

import { fetchFeed, FEED_ERROR_KINDS, type FeedFetchResult, type FeedErrorKind } from '../src/lib/server/rss'
import type { Feed } from '../src/lib/types'
import { classifyArticles } from '../src/lib/server/classify'
import {
  embedTitles,
  shouldEmbed,
  EMBEDDING_MODEL_TAG,
  EMBED_SIM_THRESHOLD,
  EMBED_WINDOW_HOURS,
} from '../src/lib/server/embeddings'
import { updateTrending } from '../src/lib/server/trending'
import { supabaseAdmin } from '../src/lib/server/supabase'

const UPSERT_BATCH = 200
const GUID_QUERY_CHUNK = 1000 // existing_guids RPC POSTs the array — no URL-length limit
// Cap classify volume per run so a backlog can't blow the Action's time budget
// under the rate limiter. Deferred articles stay "new" and are picked next run.
const MAX_CLASSIFY_PER_RUN = 300
// Clustering worklist: everything unassigned from the last day, capped. Covers
// this run's inserts AND articles from runs whose embed/assign step failed
// (self-heal — driven purely by cluster_id IS NULL, nothing is ever orphaned).
const ASSIGN_LOOKBACK_HOURS = 24
const ASSIGN_CAP = 300
const ASSIGN_RPC_CHUNK = 100
const ID_QUERY_CHUNK = 100 // .in() filters travel in the URL — keep chunks small

type RunStats = Record<string, unknown>

// A sources-table row: the fetchable Feed shape plus health bookkeeping.
type SourceRow = Feed & {
  id: string
  enabled: boolean
  consecutive_failures: number
}

// The roster lives in the DB (sources table). A failed/empty roster query must
// FAIL the run loudly — a silent zero-feed "success" would record error=null
// and reset the freshness dead-man's switch.
async function loadSources(): Promise<SourceRow[]> {
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
// counter; failures increment it and record the kind/detail. Best-effort —
// health bookkeeping must never fail the run.
async function updateSourceHealth(results: FeedFetchResult[]): Promise<void> {
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
  const failed = results
    .filter((r) => r.error)
    .map((r) => ({
      ...base(r.feed as SourceRow),
      consecutive_failures: ((r.feed as SourceRow).consecutive_failures ?? 0) + 1,
      last_error_kind: r.error!.kind,
      // Feed error details can embed binary/HTML response snippets — Postgres
      // text rejects NUL (and friends); one bad row poisons the whole batch.
      last_error: r.error!.detail.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 300),
    }))
  for (const rows of [ok, failed]) {
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const { error } = await supabaseAdmin
        .from('sources')
        .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: 'id' })
      if (error) console.error('[pipeline] source health write failed:', error)
    }
  }
}

function logFeedSummary(results: FeedFetchResult[]) {
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

async function existingGuids(guids: string[]): Promise<Set<string>> {
  const existing = new Set<string>()
  for (let i = 0; i < guids.length; i += GUID_QUERY_CHUNK) {
    const chunk = guids.slice(i, i + GUID_QUERY_CHUNK)
    const { data, error } = await supabaseAdmin.rpc('existing_guids', { check_guids: chunk })
    if (error) console.error('[pipeline] existing_guids RPC error:', error)
    ;(data as Array<{ guid: string }> | null)?.forEach((r) => existing.add(r.guid))
  }
  return existing
}

function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  return +sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(4)
}

// SHADOW MODE ONLY: measures how an embedding-similarity relevance pre-filter
// WOULD have agreed with the LLM, logged to pipeline_runs.stats.cls_prefilter.
// Zero behavior change — enabling a threshold is a later, data-backed change.
async function classifyShadowStats(
  toClassify: Array<{ guid: string; title: string }>,
  relevant: Set<string>,
): Promise<Record<string, unknown> | null> {
  try {
    const { data: raw, error } = await supabaseAdmin.rpc('relevant_centroid', { p_days: 14 })
    if (error || !raw) return null
    const centroid = (typeof raw === 'string' ? JSON.parse(raw) : raw) as number[]
    // avg() of unit vectors is not unit-length — normalize for cosine.
    const norm = Math.sqrt(centroid.reduce((acc, x) => acc + x * x, 0))
    if (!norm) return null
    const unit = centroid.map((x) => x / norm)

    const embeddable = toClassify.filter((a) => shouldEmbed(a.title))
    if (embeddable.length === 0) return null
    const vecs = await embedTitles(embeddable.map((a) => a.title))
    const sims = embeddable.map((a, i) => ({ accepted: relevant.has(a.guid), sim: dot(vecs[i], unit) }))

    const acc = sims.filter((x) => x.accepted).map((x) => x.sim).sort((m, n) => m - n)
    const rej = sims.filter((x) => !x.accepted).map((x) => x.sim).sort((m, n) => m - n)
    const agreement: Record<string, number> = {}
    // First live reading: accepted_p50 0.875 vs rejected_p50 0.849 — the
    // decision zone sits in 0.84-0.88, not the originally guessed 0.74-0.82.
    for (const t of [0.84, 0.85, 0.86, 0.87, 0.88]) {
      agreement[String(t)] = +(sims.filter((x) => x.sim >= t === x.accepted).length / sims.length).toFixed(3)
    }
    return {
      n: sims.length,
      accepted_p10: percentile(acc, 10),
      accepted_p50: percentile(acc, 50),
      rejected_p50: percentile(rej, 50),
      rejected_p90: percentile(rej, 90),
      agreement,
    }
  } catch (err) {
    console.error('[pipeline] classify shadow stats failed (non-fatal):', err)
    return null
  }
}

// Embeds unassigned recent titles and assigns stories via the
// assign_story_by_embedding RPC (star linkage against story representatives,
// item-relative ±EMBED_WINDOW_HOURS window; also mirrors the legacy
// cluster_id for N-1 PWA clients). Failure here never fails the run:
// articles stay story_id NULL and the next run picks them up.
async function embedAndAssignClusters(stats: RunStats): Promise<void> {
  try {
    const since = new Date(Date.now() - ASSIGN_LOOKBACK_HOURS * 3600_000).toISOString()
    const { data: unassigned, error: qError } = await supabaseAdmin
      .from('articles')
      .select('id, title, published_at')
      .is('story_id', null)
      .gte('fetched_at', since)
      // Chronological ASC so the RPC lets later items join clusters started by
      // earlier ones in the same call; null published_at last (anchors to now()).
      .order('published_at', { ascending: true, nullsFirst: false })
      .limit(ASSIGN_CAP)
    if (qError) throw new Error(`worklist query failed: ${JSON.stringify(qError)}`)
    if (!unassigned?.length) {
      stats.embedded = 0
      stats.clusters_assigned = 0
      return
    }

    const embeddable = unassigned.filter((a) => shouldEmbed(a.title))
    stats.embed_skipped = unassigned.length - embeddable.length

    // Articles embedded by a previous run whose assignment failed: reuse the
    // stored vector instead of re-embedding.
    const stored = new Map<string, number[]>()
    for (let i = 0; i < embeddable.length; i += ID_QUERY_CHUNK) {
      const ids = embeddable.slice(i, i + ID_QUERY_CHUNK).map((a) => a.id)
      const { data, error } = await supabaseAdmin
        .from('article_embeddings')
        .select('article_id, embedding')
        .in('article_id', ids)
      if (error) throw new Error(`stored-embedding fetch failed: ${JSON.stringify(error)}`)
      for (const r of data ?? []) {
        stored.set(r.article_id, typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding)
      }
    }

    const toEmbed = embeddable.filter((a) => !stored.has(a.id))
    const fresh = await embedTitles(toEmbed.map((a) => a.title))
    const vecById = new Map<string, number[]>(stored)
    toEmbed.forEach((a, i) => vecById.set(a.id, fresh[i]))
    stats.embedded = fresh.length

    const items = embeddable
      .filter((a) => vecById.has(a.id))
      .map((a) => ({ id: a.id, published_at: a.published_at, embedding: vecById.get(a.id)! }))

    let assigned = 0
    let newClusters = 0
    for (let i = 0; i < items.length; i += ASSIGN_RPC_CHUNK) {
      const { data, error } = await supabaseAdmin.rpc('assign_story_by_embedding', {
        p_items: items.slice(i, i + ASSIGN_RPC_CHUNK),
        p_model: EMBEDDING_MODEL_TAG,
        p_threshold: EMBED_SIM_THRESHOLD,
        p_window_hours: EMBED_WINDOW_HOURS,
      })
      if (error) throw new Error(`assign RPC failed: ${JSON.stringify(error)}`)
      const rows = (data ?? []) as Array<{ r_is_new: boolean }>
      assigned += rows.length
      newClusters += rows.filter((r) => r.r_is_new).length
    }
    stats.clusters_assigned = assigned
    stats.clusters_new = newClusters
    console.log(
      `[pipeline] clustering: embedded ${fresh.length} (reused ${stored.size}, skipped ${stats.embed_skipped}), ` +
        `assigned ${assigned} -> ${newClusters} new clusters (threshold ${EMBED_SIM_THRESHOLD})`,
    )
  } catch (err) {
    // Same degradation contract as the old LLM clusterer's empty-map fallback.
    console.error('[pipeline] clustering FAILED (articles stay unassigned; next run self-heals):', err)
    stats.cluster_error = String(err).slice(0, 300)
  }
}

async function recordRun(startedAt: Date, stats: RunStats, error: unknown): Promise<void> {
  // Best-effort: a run-log failure must never fail the run (and a total
  // Supabase-connectivity fatal can't record itself — accepted).
  try {
    const { error: insertError } = await supabaseAdmin.from('pipeline_runs').insert({
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      error: error ? String(error).slice(0, 1000) : null,
      stats,
    })
    if (insertError) console.error('[pipeline] run-log write failed:', insertError)
  } catch (err) {
    console.error('[pipeline] run-log write failed:', err)
  }
}

// Operator health gate, read once per run. ops_health() returns DB size + the
// last retention-cron outcome. Runs at the END of a run: a tripped threshold
// must ALERT (fail the run → GitHub issue), never halt ingestion (already done).
async function checkOpsHealth(stats: RunStats): Promise<void> {
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

// Local-model clustering + trending + the ops-health gate. Shared by the
// no-new-articles path and the main path so every run captures trending status
// and DB health (and self-heals clustering).
async function finalize(stats: RunStats, startedAt: number): Promise<void> {
  await embedAndAssignClusters(stats)
  stats.trending = await updateTrending()
  await checkOpsHealth(stats)
  console.log(`[pipeline] done in ${Date.now() - startedAt}ms`)
}

async function run(stats: RunStats): Promise<void> {
  const startedAt = Date.now()

  // 1. Load the roster from the DB, then fetch every feed in parallel;
  //    failures are recorded (and proxy-retried), never silently dropped.
  const sources = await loadSources()
  const settled = await Promise.allSettled(sources.map((feed) => fetchFeed(feed)))
  const results: FeedFetchResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { feed: sources[i], via: 'direct', articles: [], error: { kind: 'network', detail: String(s.reason) } },
  )
  Object.assign(stats, logFeedSummary(results))
  await updateSourceHealth(results)

  // Dead-man's switch: if EVERY feed failed (runner egress outage, proxy down,
  // DNS), a "no new articles" success would reset the freshness clock on the
  // exact failure class the readout exists for. Fail loudly — after the health
  // write (so per-source failures are recorded); recordRun fires via finally.
  if ((stats.feeds_ok as number) === 0) {
    throw new Error('all feeds failed to fetch — refusing to record a successful run')
  }

  const candidates = results.flatMap((r) => r.articles).filter((a) => a.guid !== '')

  // De-dup within this run: the same article can arrive from multiple feeds.
  const uniqueByGuid = [...new Map(candidates.map((a) => [a.guid, a])).values()]

  // 2. De-dup against the DB (kept articles UNION recorded rejects) so we only
  //    spend LLM tokens on genuinely-unseen articles.
  const existing = await existingGuids(uniqueByGuid.map((a) => a.guid))
  const fresh = uniqueByGuid.filter((a) => !existing.has(a.guid))
  console.log(`[pipeline] ${candidates.length} items -> ${uniqueByGuid.length} unique -> ${fresh.length} new`)
  Object.assign(stats, { items: candidates.length, unique: uniqueByGuid.length, new: fresh.length })

  if (fresh.length === 0) {
    // Still run clustering: a previous run's embed/assign failure leaves
    // backlog that must heal even on quiet runs.
    console.log('[pipeline] no new articles; clustering self-heal + trending only')
    await finalize(stats, startedAt)
    return
  }

  // 3. Classify new articles. Newest first, capped per run; the rest stay "new"
  //    and are reconsidered next run.
  const ordered = [...fresh].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
  const toClassify = ordered.slice(0, MAX_CLASSIFY_PER_RUN)
  if (fresh.length > toClassify.length) {
    console.log(`[pipeline] deferring ${fresh.length - toClassify.length} new articles to next run (classify cap)`)
  }
  const { relevant, rejected, failedBatches, totalBatches } = await classifyArticles(toClassify)
  const articles = toClassify.filter((a) => relevant.has(a.guid))
  console.log(`[pipeline] ${articles.length} relevant, ${rejected.size} rejected of ${toClassify.length} classified`)
  Object.assign(stats, {
    classified: toClassify.length,
    deferred: fresh.length - toClassify.length,
    relevant: articles.length,
    rejected: rejected.size,
    cls_batches_failed: failedBatches,
    cls_batches_total: totalBatches,
  })
  const shadow = await classifyShadowStats(toClassify, relevant)
  if (shadow) stats.cls_prefilter = shadow

  // 4. Upsert relevant articles + record rejects so they're never re-classified.
  let inserted = 0
  for (let i = 0; i < articles.length; i += UPSERT_BATCH) {
    const batch = articles.slice(i, i + UPSERT_BATCH)
    const { data, error } = await supabaseAdmin
      .from('articles')
      .upsert(batch, { onConflict: 'guid', ignoreDuplicates: true })
      .select('id')
    if (error) console.error(`[pipeline] upsert error (batch ${Math.floor(i / UPSERT_BATCH) + 1}):`, error)
    else inserted += data?.length ?? 0
  }
  console.log(`[pipeline] inserted ${inserted} new articles`)
  stats.inserted = inserted

  if (rejected.size > 0) {
    // Project explicit, homogeneous columns (never spread the article objects —
    // PostgREST 400s on unknown columns, and a batch needs uniform keys).
    // source_id + lang give the curation pass accept-rate per source/language.
    const byGuid = new Map(toClassify.map((a) => [a.guid, a]))
    const rejectRows = [...rejected].map((guid) => {
      const a = byGuid.get(guid)
      return { guid, title: a?.title ?? null, source_id: a?.source_id ?? null, lang: a?.source_lang ?? null }
    })
    for (let i = 0; i < rejectRows.length; i += UPSERT_BATCH) {
      const batch = rejectRows.slice(i, i + UPSERT_BATCH)
      const { error } = await supabaseAdmin
        .from('classified_rejects')
        .upsert(batch, { onConflict: 'guid', ignoreDuplicates: true })
      if (error) console.error('[pipeline] reject record error:', error)
    }
  }

  // 5/6/7. Embed + assign stories (story_id IS NULL worklist self-heals),
  //         recompute trending, and read the ops-health gate.
  await finalize(stats, startedAt)

  // 8. Loud failure for a TOTAL LLM outage (e.g. model deprecation) — AFTER the
  //    inserts (keyword-fallback survivors still ingested) and the clustering
  //    self-heal, so a Groq outage degrades rather than dropping everything, but
  //    the run still FAILS (freshness amber + GitHub issue) instead of laundering
  //    a near-empty result into a green run.
  if (totalBatches > 0 && failedBatches === totalBatches) {
    throw new Error(`all ${totalBatches} classify batches failed — LLM appears down (relevant=${articles.length})`)
  }
}

async function main() {
  const startedAt = new Date()
  const stats: RunStats = {}
  let runError: unknown = null
  try {
    await run(stats)
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
