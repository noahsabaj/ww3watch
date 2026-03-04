import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/server/supabase'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const [articlesResult, trendingResult] = await Promise.all([
    supabaseAdmin
      .from('articles')
      .select('*')
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('fetched_at', { ascending: false })
      .limit(500),
    supabaseAdmin
      .from('trending')
      .select('article_id, rank')
      .order('rank', { ascending: true }),
  ])

  if (articlesResult.error) {
    console.error('[load] Supabase error:', articlesResult.error)
    throw error(503, 'Could not load articles. Please try again.')
  }

  const trendingIds: string[] = (trendingResult.data ?? []).map(t => t.article_id)
  return { articles: articlesResult.data ?? [], trendingIds }
}
