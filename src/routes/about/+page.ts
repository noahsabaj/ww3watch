// About/methodology page data: the public source roster (with health) and the
// region distribution of the current serving window. Both anon-readable.
import { supabase } from '$lib/supabase'
import type { PageLoad } from './$types'

export type SourceRosterRow = {
  name: string
  region: string
  lang: string
  enabled: boolean
  last_ok_at: string | null
  consecutive_failures: number
}

export const load: PageLoad = async () => {
  const [sourcesResult, windowResult] = await Promise.all([
    supabase
      .from('sources')
      .select('name, region, lang, enabled, last_ok_at, consecutive_failures')
      .order('region')
      .order('name'),
    supabase
      .from('articles')
      .select('source_region')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(500),
  ])

  const regionCounts = new Map<string, number>()
  for (const row of windowResult.data ?? []) {
    regionCounts.set(row.source_region, (regionCounts.get(row.source_region) ?? 0) + 1)
  }

  return {
    sources: (sourcesResult.data ?? []) as SourceRosterRow[],
    windowTotal: windowResult.data?.length ?? 0,
    regionCounts: [...regionCounts.entries()].sort((a, b) => b[1] - a[1]),
  }
}
