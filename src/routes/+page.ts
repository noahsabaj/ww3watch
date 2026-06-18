// Client-side initial load (runs in the browser — see +layout.ts ssr=false).
// Replaces the old +page.server.ts SSR load. Reads with the anon Supabase client,
// so the `articles` and `trending` tables need RLS policies allowing anon SELECT.
// Realtime (in +page.svelte) then keeps the feed live.

import { supabase } from '$lib/supabase'
import type { PageLoad } from './$types'

export const load: PageLoad = async () => {
  const [articlesResult, trendingResult, statusResult] = await Promise.all([
    // Explicit column list — only what the feed/reader render. Drops
    // guid/feed_url/source_id (~25% of row width × 500 × every boot,
    // against the 5GB/mo egress budget); none are read client-side. Realtime
    // payloads still carry full rows, so the Article type marks those optional.
    supabase
      .from('articles')
      .select('id,title,url,summary,published_at,fetched_at,source_name,source_region,source_lang,source_affiliation,story_id,body_hash')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('fetched_at', { ascending: false })
      .limit(500),
    supabase.from('trending').select('article_id, rank, story_id').order('rank', { ascending: true }),
    // Last successful ingestion-run timestamp (scalar) — the header's
    // "updated Xm ago" readout and dead-man's switch.
    supabase.rpc('pipeline_status'),
  ])

  if (articlesResult.error) {
    console.error('[load] Supabase error:', articlesResult.error)
  }

  const trending: { article_id: string; story_id: string | null }[] = (trendingResult.data ?? []).map(
    (t) => ({ article_id: t.article_id, story_id: t.story_id ?? null }),
  )
  return {
    articles: articlesResult.data ?? [],
    trending,
    lastUpdatedAt: (statusResult.data as string | null) ?? null,
    loadError: !!articlesResult.error,
  }
}
