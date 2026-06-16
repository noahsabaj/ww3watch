import { callLLM } from './llm'
import { groupByStoryId, wireDuplicateIds } from '../cluster'
import { supabaseAdmin } from './supabase'

const TRENDING_WINDOW_HOURS = 4
const CANDIDATE_LIMIT = 20                      // max clusters to send to LLM
const PICK_COUNT = 3                            // stories to select

const SYSTEM_PROMPT = `You are the story curator for WW3Watch — a real-time tracker of escalating global conflicts: wars, military strikes, assassinations, nuclear threats, coups, and major geopolitical crises.

You will receive a numbered list of news clusters. Each entry shows the headline, how many INDEPENDENT sources cover it (wire reprints already collapsed), across how many distinct regions and languages, and how old it is.

Pick the ${PICK_COUNT} most geopolitically significant, actively-developing stories that users should see right now.

Prioritize: active combat, imminent WMD/nuclear threats, assassinations, regime changes, major escalations with new developments. Multi-region, multi-language corroboration is the strongest signal a story is both real and globally significant — prefer it over a story echoed by many same-region outlets.
De-prioritize: background tensions at equilibrium, diplomatic statements with no action, economic news, old ongoing conflicts with no new development, single-source or single-region claims no one else has picked up.

Return ONLY a JSON array of ${PICK_COUNT} integers (0-indexed positions from the list). No explanation. No markdown. Example: [2, 0, 11]`

// Returns a short status string for pipeline_runs.stats (so chronic trending-LLM
// failure is visible, not just stale selected_at values): 'updated:N' | 'empty'
// | 'error:fetch|llm|delete|insert'.
export async function updateTrending(): Promise<string> {
  const since = new Date(Date.now() - TRENDING_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const { data: recent, error: dbError } = await supabaseAdmin
    .from('articles')
    .select('*')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(500)

  if (dbError || !recent?.length) {
    console.error('[trending] Failed to fetch recent articles:', dbError)
    return dbError ? 'error:fetch' : 'empty'
  }

  // Same grouping the client renders (pipeline-assigned story_ids; unassigned
  // articles are singletons). Score by INDEPENDENT source count — wire reprints
  // collapsed via the shared helper, so an AP copy echoed by 5 outlets counts
  // once — and surface region/language breadth so the curator can reward genuine
  // cross-region corroboration over same-region echo.
  const now = Date.now()
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const scored = groupByStoryId(recent)
    .map((c) => {
      const wire = wireDuplicateIds(c.articles)
      const independent = new Set(
        c.articles.filter((a) => !wire.has(a.id)).map((a) => a.source_name),
      ).size
      const regions = new Set(c.articles.map((a) => a.source_region)).size
      const langs = new Set(c.articles.map((a) => a.source_lang)).size
      return { c, independent, regions, langs }
    })
    .sort((a, b) => b.independent - a.independent)
    .slice(0, CANDIDATE_LIMIT)

  if (scored.length === 0) return 'empty'
  const clusters = scored.map((s) => s.c)

  const userContent = scored
    .map((s, i) => {
      const ageMin = s.c.representative.published_at
        ? Math.round((now - new Date(s.c.representative.published_at).getTime()) / 60000)
        : 0
      return `${i}. [${plural(s.independent, 'independent source')} / ${plural(s.regions, 'region')} / ${plural(s.langs, 'lang')}, ${ageMin}m ago] "${s.c.representative.title}"`
    })
    .join('\n')

  let indices: number[]
  try {
    const clean = await callLLM(
      [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
      40,
    )
    const parsed: unknown = JSON.parse(clean)

    if (
      !Array.isArray(parsed) ||
      parsed.length !== PICK_COUNT ||
      !parsed.every((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < clusters.length) ||
      // Duplicate indices would insert duplicate article_id PKs AFTER the delete
      // succeeded, leaving trending empty — reject and keep the previous selection.
      new Set(parsed).size !== PICK_COUNT
    ) {
      throw new Error(`Bad LLM response: ${clean}`)
    }

    indices = parsed as number[]
  } catch (err) {
    console.error('[trending] LLM selection failed, skipping update:', err)
    return 'error:llm' // keep previous trending intact on failure
  }

  const rows = indices.map((clusterIdx, rank) => ({
    // article_id stays the newest member's id — bit-identical to the
    // pre-stories value, which N-1 clients resolve by membership. New clients
    // resolve by story_id directly (null for unassigned singletons).
    article_id: clusters[clusterIdx].representative.id,
    story_id: clusters[clusterIdx].storyId,
    rank,
    selected_at: new Date().toISOString(),
  }))

  // The .neq filter only exists to satisfy safeupdate (no unfiltered deletes).
  // If the delete fails, abort — inserting would PK-conflict and empty nothing,
  // but we'd log noise; keeping the previous selection is the correct outcome.
  const { error: deleteError } = await supabaseAdmin.from('trending').delete().neq('article_id', '')
  if (deleteError) {
    console.error('[trending] delete failed, keeping previous selection:', deleteError)
    return 'error:delete'
  }
  const { error } = await supabaseAdmin.from('trending').insert(rows)
  if (error) {
    console.error('[trending] Supabase insert error:', error)
    return 'error:insert'
  }
  console.log(`[trending] Updated: ${rows.map((r) => r.article_id).join(', ')}`)
  return `updated:${rows.length}`
}
