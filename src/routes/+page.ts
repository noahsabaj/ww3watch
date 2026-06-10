// Client-side initial load (runs in the browser — see +layout.ts ssr=false).
// Replaces the old +page.server.ts SSR load. Reads with the anon Supabase client,
// so the `articles` and `trending` tables need RLS policies allowing anon SELECT.
// Realtime (in +page.svelte) then keeps the feed live.

import { supabase } from '$lib/supabase'
import type { PageLoad } from './$types'

export const load: PageLoad = async () => {
  const [articlesResult, trendingResult, statusResult] = await Promise.all([
    supabase
      .from('articles')
      .select('*')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('fetched_at', { ascending: false })
      .limit(500),
    supabase.from('trending').select('article_id, rank').order('rank', { ascending: true }),
    // Last successful ingestion-run timestamp (scalar) — the header's
    // "updated Xm ago" readout and dead-man's switch.
    supabase.rpc('pipeline_status'),
  ])

  if (articlesResult.error) {
    console.error('[load] Supabase error:', articlesResult.error)
  }

  const trendingIds: string[] = (trendingResult.data ?? []).map((t) => t.article_id)
  return {
    articles: articlesResult.data ?? [],
    trendingIds,
    lastUpdatedAt: (statusResult.data as string | null) ?? null,
    loadError: !!articlesResult.error,
  }
}
