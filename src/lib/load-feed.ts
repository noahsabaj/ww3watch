import { supabase } from '$lib/supabase'
import { FEED_COLUMNS } from '$lib/feed-columns'

export async function loadFeed() {
  const [articlesResult, trendingResult, statusResult] = await Promise.all([
    // Explicit column list — only what the feed/reader render. Drops
    // guid/feed_url, keeping source_id for stable profile links. Realtime
    // payloads still carry full rows, so the Article type marks those optional.
    supabase
      .from('articles')
      .select(FEED_COLUMNS)
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
