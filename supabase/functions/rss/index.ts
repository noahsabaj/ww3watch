// Supabase Edge Function: public RSS 2.0 feed (Deno).
// Serves the newest stories so readers can subscribe in any RSS client. Items
// link to the app deep-link (?article=<id>) so they open in WW3Watch's reader
// (with the cross-source timeline), not straight to one outlet.
//
// ?major=1 narrows it to stories a classifier judged a significant event
// (articles.severity ≥ MAJOR_SEVERITY, src/lib/signals.ts) — the low-volume feed
// to point an alerting tool or a phone's RSS notifications at.
//
// verify_jwt is off (deploy-functions.yml passes --no-verify-jwt) so RSS readers,
// which can't send an apikey header, can fetch it. The abuse control is the
// 15-minute Cache-Control: readers/CDNs cache between polls, bounding egress
// against the project's tight budget. Read-only, public data — no rate-limit row.

import { corsHeaders } from '../_shared/http.ts'
import { serviceClient } from '../_shared/client.ts'
import { buildRssXml, type FeedItem } from '../_shared/rss.ts'

const supabase = serviceClient()
const SITE_URL = 'https://ww3watch.org'
// Derived dynamically from SUPABASE_URL env so self-hosted / test environments work seamlessly.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const FEED_URL = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/rss`
  : 'https://qusjbpknlduuklnfciws.supabase.co/functions/v1/rss'
const MAX_ITEMS = 40
// Over-fetch so story dedup still yields a full feed when recent stories have
// many members.
const FETCH_LIMIT = 150
// Keep in step with MAJOR_SEVERITY in src/lib/signals.ts (Deno cannot import it).
const MAJOR_SEVERITY = 0.55

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405, headers: corsHeaders })
  }

  const major = new URL(req.url).searchParams.get('major') === '1'
  let query = supabase
    .from('articles')
    .select('id, title, summary, published_at, source_name, source_region, story_id')
  // Statements about grave subjects score low on severity by design, so this
  // is events, not threats.
  if (major) query = query.gte('severity', MAJOR_SEVERITY)
  const { data, error } = await query
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

  const xml = buildRssXml(items, {
    siteUrl: SITE_URL,
    feedUrl: major ? `${FEED_URL}?major=1` : FEED_URL,
    ...(major
      ? {
          title: 'WW3Watch — Major events',
          description: 'Only stories judged a significant event: deadly attacks, major offensives, state-level escalation. Judged from the headline by a classifier, not an editor.',
        }
      : {}),
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
