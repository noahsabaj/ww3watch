// src/routes/+page.server.ts
import { supabaseAdmin } from '$lib/server/supabase'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const { data: articles } = await supabaseAdmin
    .from('articles')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(500)

  return { articles: articles ?? [] }
}
