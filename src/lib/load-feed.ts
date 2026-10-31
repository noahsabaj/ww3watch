import { supabase } from '#lib/supabase.js'
import { FEED_COLUMNS } from '#lib/feed-columns.js'

/** Supabase answers every request with 402 Payment Required while a Free plan
 *  project is restricted for going over a quota (October 2026: egress), until
 *  the quota refills at the next billing cycle. Retrying cannot help, so the
 *  feed says so instead of offering Retry (docs/OPERATIONS.md, Egress). */
export const QUOTA_RESTRICTED = 402

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
    console.error('[load] Supabase error:', articlesResult.status, articlesResult.error)
  }

  const trending: { article_id: string; story_id: string | null }[] = (trendingResult.data ?? []).map(
    (t) => ({ article_id: t.article_id, story_id: t.story_id ?? null }),
  )
  return {
    articles: articlesResult.data ?? [],
    trending,
    lastUpdatedAt: (statusResult.data as string | null) ?? null,
    loadError: !!articlesResult.error,
    restricted: !!articlesResult.error && articlesResult.status === QUOTA_RESTRICTED,
  }
}
