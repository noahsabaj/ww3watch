// WW3Watch ingestion pipeline — runs on a schedule via GitHub Actions
// (.github/workflows/pipeline.yml) or locally with: node --import tsx scripts/run-pipeline.ts
//
// Replaces the old GET /api/cron serverless route. Reuses the same logic from
// src/lib/server/*, which now reads config from process.env (see env.ts).
//
// Pipeline: fetch all feeds -> de-dup (within run + against DB) -> classify only
// NEW articles -> upsert -> assign clusters to unclustered -> recompute trending.

import { FEEDS } from '../src/lib/feeds'
import { fetchFeed } from '../src/lib/server/rss'
import { classifyArticles } from '../src/lib/server/classify'
import { assignClusters } from '../src/lib/server/cluster-llm'
import { updateTrending } from '../src/lib/server/trending'
import { supabaseAdmin } from '../src/lib/server/supabase'

const UPSERT_BATCH = 200
// Keep the guid `.in(...)` list small: guids are often long URLs, and a big list
// makes a GET URL that PostgREST/Kong rejects (414).
const GUID_QUERY_CHUNK = 100
const MAX_UNASSIGNED_PER_RUN = 100 // bound the clustering LLM prompt size
// Cap classify volume per run so a backlog can't blow the Action's time budget
// under the rate limiter. Deferred articles stay "new" and are picked next run.
const MAX_CLASSIFY_PER_RUN = 600

async function main() {
  const startedAt = Date.now()

  // 1. Fetch every feed in parallel; a dead feed yields [] and never sinks the run.
  const results = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed)))
  const candidates = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchFeed>>> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .filter((a) => a.guid !== '')

  // De-dup within this run: the same article can arrive from multiple feeds.
  const uniqueByGuid = [...new Map(candidates.map((a) => [a.guid, a])).values()]

  // 2. De-dup against the DB so we only spend LLM tokens on genuinely new articles.
  //    This is what keeps classification well under the Cerebras free-tier budget.
  const guids = uniqueByGuid.map((a) => a.guid)
  const existing = new Set<string>()
  for (let i = 0; i < guids.length; i += GUID_QUERY_CHUNK) {
    const chunk = guids.slice(i, i + GUID_QUERY_CHUNK)
    const { data, error } = await supabaseAdmin.from('articles').select('guid').in('guid', chunk)
    if (error) console.error('[pipeline] guid lookup error:', error)
    data?.forEach((r) => existing.add(r.guid))
  }
  const fresh = uniqueByGuid.filter((a) => !existing.has(a.guid))
  console.log(`[pipeline] ${candidates.length} items -> ${uniqueByGuid.length} unique -> ${fresh.length} new`)

  if (fresh.length === 0) {
    console.log('[pipeline] no new articles; refreshing trending only')
    await updateTrending()
    console.log(`[pipeline] done in ${Date.now() - startedAt}ms`)
    return
  }

  // 3. Classify new articles (LLM, rate-limited + 429-retried; keyword fallback
  //    per failed batch). Newest first, capped per run; the rest defer to next run.
  const ordered = [...fresh].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
  const toClassify = ordered.slice(0, MAX_CLASSIFY_PER_RUN)
  if (fresh.length > toClassify.length) {
    console.log(`[pipeline] deferring ${fresh.length - toClassify.length} new articles to next run (classify cap)`)
  }
  const relevantGuids = await classifyArticles(toClassify)
  const articles = toClassify.filter((a) => relevantGuids.has(a.guid))
  console.log(`[pipeline] ${articles.length}/${toClassify.length} classified articles are relevant`)

  // 4. Upsert. ignoreDuplicates => ON CONFLICT DO NOTHING, and .select() returns
  //    only the rows actually inserted, so the count is honest.
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

  // 5. Assign cluster_ids to any still-unclustered articles. Driven purely by
  //    cluster_id IS NULL (not a time window), so a missed/slow run never orphans
  //    an article; capped to keep the clustering LLM prompt bounded.
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
    console.log(`[pipeline] assigned clusters to ${unassigned.length} articles`)
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
