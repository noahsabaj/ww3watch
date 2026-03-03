import { json } from '@sveltejs/kit'
import { CRON_SECRET } from '$env/static/private'
import { FEEDS } from '$lib/feeds'
import { fetchFeed } from '$lib/server/rss'
import { supabaseAdmin } from '$lib/server/supabase'
import { isRelevant } from '$lib/relevance'
import type { RequestHandler } from './$types'

const BATCH_SIZE = 200

export const GET: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const results = await Promise.allSettled(FEEDS.map(feed => fetchFeed(feed)))

  const articles = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchFeed>>> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(a => a.guid !== '')
    .filter(a => isRelevant(a.title, a.summary ?? '', a.source_lang))

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
  return json({ inserted: totalInserted, total: articles.length })
}
