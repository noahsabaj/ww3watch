import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/server/supabase'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const { data: articles, error: dbError } = await supabaseAdmin
    .from('articles')
    .select('*')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('fetched_at', { ascending: false })
    .limit(500)

  if (dbError) {
    console.error('[load] Supabase error:', dbError)
    throw error(503, 'Could not load articles. Please try again.')
  }

  return { articles: articles ?? [] }
}
