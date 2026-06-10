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

import { FEEDS } from '../src/lib/feeds'
import { fetchFeed, type FeedFetchResult, type FeedErrorKind } from '../src/lib/server/rss'
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

function logFeedSummary(results: FeedFetchResult[]) {
  const ok = results.filter((r) => !r.error)
  const direct = ok.filter((r) => r.via === 'direct').length
  const proxy = ok.filter((r) => r.via === 'proxy').length
  const failed = results.filter((r) => r.error)
  const byKind: Record<FeedErrorKind, number> = { http: 0, timeout: 0, parse: 0, network: 0 }
  for (const r of failed) byKind[r.error!.kind]++

  console.log(
    `[pipeline] feeds ok ${ok.length}/${results.length} (direct ${direct}, proxy ${proxy}) | ` +
      `failed ${failed.length}: http=${byKind.http} timeout=${byKind.timeout} parse=${byKind.parse} network=${byKind.network}`,
  )
  for (const r of failed) {
    console.log(`[feed-fail] ${r.feed.name} [${r.feed.region}] ${r.error!.kind}: ${r.error!.detail}`)
  }

  return { feeds_ok: ok.length, feeds_direct: direct, feeds_proxy: proxy, feeds_failed: failed.length, fail_kinds: byKind }
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

// Embeds unassigned recent titles and assigns cluster_ids via the
// assign_clusters_by_embedding RPC (star linkage against representatives,
// item-relative ±EMBED_WINDOW_HOURS window). Failure here never fails the run:
// articles stay cluster_id NULL and the next run picks them up.
async function embedAndAssignClusters(stats: RunStats): Promise<void> {
  try {
    const since = new Date(Date.now() - ASSIGN_LOOKBACK_HOURS * 3600_000).toISOString()
    const { data: unassigned, error: qError } = await supabaseAdmin
      .from('articles')
      .select('id, title, published_at')
      .is('cluster_id', null)
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
      const { data, error } = await supabaseAdmin.rpc('assign_clusters_by_embedding', {
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

async function run(stats: RunStats): Promise<void> {
  const startedAt = Date.now()

  // 1. Fetch every feed in parallel; failures are recorded (and proxy-retried),
  //    never silently dropped.
  const settled = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed)))
  const results: FeedFetchResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { feed: FEEDS[i], via: 'direct', articles: [], error: { kind: 'network', detail: String(s.reason) } },
  )
  Object.assign(stats, logFeedSummary(results))

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
    await embedAndAssignClusters(stats)
    await updateTrending()
    console.log(`[pipeline] done in ${Date.now() - startedAt}ms`)
    return
  }

  // 3. Classify new articles. Newest first, capped per run; the rest stay "new"
  //    and are reconsidered next run.
  const ordered = [...fresh].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
  const toClassify = ordered.slice(0, MAX_CLASSIFY_PER_RUN)
  if (fresh.length > toClassify.length) {
    console.log(`[pipeline] deferring ${fresh.length - toClassify.length} new articles to next run (classify cap)`)
  }
  const { relevant, rejected } = await classifyArticles(toClassify)
  const articles = toClassify.filter((a) => relevant.has(a.guid))
  console.log(`[pipeline] ${articles.length} relevant, ${rejected.size} rejected of ${toClassify.length} classified`)
  Object.assign(stats, {
    classified: toClassify.length,
    deferred: fresh.length - toClassify.length,
    relevant: articles.length,
    rejected: rejected.size,
  })

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
    const rejectRows = [...rejected].map((guid) => ({ guid }))
    for (let i = 0; i < rejectRows.length; i += UPSERT_BATCH) {
      const batch = rejectRows.slice(i, i + UPSERT_BATCH)
      const { error } = await supabaseAdmin
        .from('classified_rejects')
        .upsert(batch, { onConflict: 'guid', ignoreDuplicates: true })
      if (error) console.error('[pipeline] reject record error:', error)
    }
  }

  // 5. Embed titles + assign cluster_ids. Driven purely by cluster_id IS NULL,
  //    so a missed/slow/failed run never orphans an article.
  await embedAndAssignClusters(stats)

  // 6. Recompute trending (keeps previous selection on LLM failure).
  await updateTrending()
  console.log(`[pipeline] done in ${Date.now() - startedAt}ms`)
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
