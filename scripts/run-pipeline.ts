// WW3Watch ingestion pipeline — runs on a schedule via GitHub Actions
// (.github/workflows/pipeline.yml) or locally with: node --import tsx scripts/run-pipeline.ts
//
// Replaces the old GET /api/cron serverless route. Reuses the same logic from
// src/lib/server/*, which now reads config from process.env (see env.ts).
//
// Pipeline: fetch all feeds -> de-dup (within run + against DB+rejects) ->
// classify only NEW articles -> upsert + record rejects -> assign clusters to
// unclustered -> recompute trending.

import { FEEDS } from '../src/lib/feeds'
import { fetchFeed, type FeedFetchResult, type FeedErrorKind } from '../src/lib/server/rss'
import { classifyArticles } from '../src/lib/server/classify'
import { assignClusters } from '../src/lib/server/cluster-llm'
import { updateTrending } from '../src/lib/server/trending'
import { supabaseAdmin } from '../src/lib/server/supabase'

const UPSERT_BATCH = 200
const GUID_QUERY_CHUNK = 1000 // existing_guids RPC POSTs the array — no URL-length limit
// Cluster batch: keep modest so the LLM reliably maps every article index.
// Newest-first, so recent articles cluster; old unclustered rows are covered by
// the client-side Jaccard fallback.
const MAX_UNASSIGNED_PER_RUN = 50
// Cap classify volume per run so a backlog can't blow the Action's time budget
// under the rate limiter. Deferred articles stay "new" and are picked next run.
const MAX_CLASSIFY_PER_RUN = 300

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

async function main() {
  const startedAt = Date.now()

  // 1. Fetch every feed in parallel; failures are recorded (and proxy-retried),
  //    never silently dropped.
  const settled = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed)))
  const results: FeedFetchResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { feed: FEEDS[i], via: 'direct', articles: [], error: { kind: 'network', detail: String(s.reason) } },
  )
  logFeedSummary(results)

  const candidates = results.flatMap((r) => r.articles).filter((a) => a.guid !== '')

  // De-dup within this run: the same article can arrive from multiple feeds.
  const uniqueByGuid = [...new Map(candidates.map((a) => [a.guid, a])).values()]

  // 2. De-dup against the DB (kept articles UNION recorded rejects) so we only
  //    spend LLM tokens on genuinely-unseen articles.
  const existing = await existingGuids(uniqueByGuid.map((a) => a.guid))
  const fresh = uniqueByGuid.filter((a) => !existing.has(a.guid))
  console.log(`[pipeline] ${candidates.length} items -> ${uniqueByGuid.length} unique -> ${fresh.length} new`)

  if (fresh.length === 0) {
    console.log('[pipeline] no new articles; refreshing trending only')
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

  // 5. Assign cluster_ids to still-unclustered articles. Driven purely by
  //    cluster_id IS NULL, so a missed/slow run never orphans an article.
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
  const [unassignedResult, recentResult] = await Promise.all([
    supabaseAdmin
      .from('articles')
      .select('id, title')
      .is('cluster_id', null)
      .order('fetched_at', { ascending: false })
      .limit(MAX_UNASSIGNED_PER_RUN),
    supabaseAdmin
      .from('articles')
      .select('id, title, cluster_id')
      .not('cluster_id', 'is', null)
      .gte('published_at', eightHoursAgo)
      .order('published_at', { ascending: false })
      .limit(200),
  ])

  const unassigned = unassignedResult.data ?? []
  const existingClusters = (recentResult.data ?? [])
    .filter((a) => a.id === a.cluster_id)
    .slice(0, 50)
    .map((a) => ({ id: a.id, title: a.title }))

  if (unassigned.length > 0) {
    const assignments = await assignClusters(unassigned, existingClusters)
    if (assignments.size === 0) {
      console.error(`[pipeline] cluster assignment FAILED (0 of ${unassigned.length} assigned)`)
    } else {
      const grouped = new Map<string, string[]>()
      for (const [articleId, clusterId] of assignments) {
        const ids = grouped.get(clusterId) ?? []
        ids.push(articleId)
        grouped.set(clusterId, ids)
      }
      for (const [clusterId, articleIds] of grouped) {
        const { error } = await supabaseAdmin.from('articles').update({ cluster_id: clusterId }).in('id', articleIds)
        if (error) console.error('[pipeline] cluster update error:', error)
      }
      console.log(`[pipeline] assigned ${assignments.size}/${unassigned.length} articles to ${grouped.size} clusters`)
    }
  }

  // 6. Recompute trending (keeps previous selection on LLM failure).
  await updateTrending()
  console.log(`[pipeline] done in ${Date.now() - startedAt}ms`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[pipeline] fatal:', err)
    process.exit(1)
  })
