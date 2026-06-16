// Supabase Edge Function: public RSS 2.0 feed (Deno).
// Serves the newest stories so readers can subscribe in any RSS client. Items
// link to the app deep-link (?article=<id>) so they open in WW3Watch's reader
// (with the cross-source timeline), not straight to one outlet.
//
// verify_jwt is off (deploy-functions.yml passes --no-verify-jwt) so RSS readers,
// which can't send an apikey header, can fetch it. The abuse control is the
// 15-minute Cache-Control: readers/CDNs cache between polls, bounding egress
// against the project's tight budget. Read-only, public data — no rate-limit row.

import { corsHeaders } from '../_shared/http.ts'
import { serviceClient } from '../_shared/client.ts'
import { buildRssXml, type FeedItem } from '../_shared/rss.ts'

const supabase = serviceClient()
const SITE_URL = 'https://noahsabaj.github.io/ww3watch'
const MAX_ITEMS = 40
// Over-fetch so story dedup still yields a full feed when recent stories have
// many members.
const FETCH_LIMIT = 150

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405, headers: corsHeaders })
  }

  const { data, error } = await supabase
    .from('articles')
    .select('id, title, summary, published_at, source_name, source_region, story_id')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('fetched_at', { ascending: false })
    .limit(FETCH_LIMIT)

  if (error) {
    console.error('[rss] query failed:', error)
    return new Response('feed temporarily unavailable', {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  // Story-first, like the feed: one item per story (newest member), singletons as-is.
  const seenStories = new Set<string>()
  const items: FeedItem[] = []
  for (const a of data ?? []) {
    const key = a.story_id ?? a.id
    if (seenStories.has(key)) continue
    seenStories.add(key)
    items.push({
      id: a.id,
      title: a.title,
      url: `${SITE_URL}/?article=${a.id}`,
      summary: a.summary,
      publishedAt: a.published_at,
      sourceName: a.source_name,
      region: a.source_region,
    })
    if (items.length >= MAX_ITEMS) break
  }

  const feedUrl = new URL(req.url).href.split('?')[0]
  const xml = buildRssXml(items, {
    siteUrl: SITE_URL,
    feedUrl,
    buildDate: items[0]?.publishedAt ?? new Date().toISOString(),
  })

  return new Response(xml, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // Bound polling egress — readers/CDNs cache for 15 min between fetches.
      'Cache-Control': 'public, max-age=900, s-maxage=900',
    },
  })
})
