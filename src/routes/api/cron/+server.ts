import { json } from '@sveltejs/kit'
import { CRON_SECRET } from '$env/static/private'
import { FEEDS } from '$lib/feeds'
import { fetchFeed } from '$lib/server/rss'
import { supabaseAdmin } from '$lib/server/supabase'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ request }) => {
  // Authenticate — Vercel sends Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Fetch all feeds in parallel — individual failures are swallowed
  const results = await Promise.allSettled(FEEDS.map(feed => fetchFeed(feed)))

  const articles = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchFeed>>> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(a => a.guid !== '')

  if (articles.length === 0) {
    return json({ inserted: 0, total: 0 })
  }

  // Upsert with ignoreDuplicates — guid is the unique key
  const { error } = await supabaseAdmin
    .from('articles')
    .upsert(articles, { onConflict: 'guid', ignoreDuplicates: true })

  if (error) {
    console.error('[cron] Supabase upsert error:', error)
    return json({ error: error.message }, { status: 500 })
  }

  console.log(`[cron] Fetched ${articles.length} articles, upserted successfully`)
  return json({ inserted: articles.length, total: articles.length })
}
