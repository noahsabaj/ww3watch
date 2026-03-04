import { json } from '@sveltejs/kit'
import { CRON_SECRET } from '$env/static/private'
import { FEEDS } from '$lib/feeds'
import { fetchFeed } from '$lib/server/rss'
import { supabaseAdmin } from '$lib/server/supabase'
import { classifyArticles } from '$lib/server/classify'
import { assignClusters } from '$lib/server/cluster-llm'
import { updateTrending } from '$lib/server/trending'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 200

export const GET: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const results = await Promise.allSettled(FEEDS.map(feed => fetchFeed(feed)))

  const candidates = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchFeed>>> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(a => a.guid !== '')

  const relevantGuids = await classifyArticles(candidates)
  const articles = candidates.filter(a => relevantGuids.has(a.guid))

  if (articles.length === 0) {
    return json({ inserted: 0, total: 0 })
  }

  // Batch upserts to avoid hitting PostgREST request size limits
  let totalInserted = 0
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    const batch = articles.slice(i, i + BATCH_SIZE)
    const { error } = await supabaseAdmin
      .from('articles')
      .upsert(batch, { onConflict: 'guid', ignoreDuplicates: true })

    if (error) {
      console.error(`[cron] Supabase upsert error on batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error)
    } else {
      totalInserted += batch.length
    }
  }

  console.log(`[cron] Fetched ${articles.length} articles, inserted ${totalInserted} new`)

  // Assign cluster_ids to newly inserted articles
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()

  const [unassignedResult, recentResult] = await Promise.all([
    supabaseAdmin
      .from('articles')
      .select('id, title')
      .is('cluster_id', null)
      .gte('fetched_at', tenMinAgo),
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
    .filter(a => a.id === a.cluster_id)
    .slice(0, 50)
    .map(a => ({ id: a.id, title: a.title }))

  if (unassigned.length > 0) {
    const assignments = await assignClusters(unassigned, existingClusters)

    // Group article IDs by their assigned cluster_id for batch updates
    const grouped = new Map<string, string[]>()
    for (const [articleId, clusterId] of assignments) {
      const ids = grouped.get(clusterId) ?? []
      ids.push(articleId)
      grouped.set(clusterId, ids)
    }
    for (const [clusterId, articleIds] of grouped) {
      const { error } = await supabaseAdmin
        .from('articles')
        .update({ cluster_id: clusterId })
        .in('id', articleIds)
      if (error) console.error('[cron] cluster update error:', error)
    }
    console.log(`[cron] Assigned clusters to ${unassigned.length} articles`)
  }

  await updateTrending()
  return json({ inserted: totalInserted, total: articles.length })
}
