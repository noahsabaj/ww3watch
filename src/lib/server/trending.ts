import { callLLM } from '$lib/server/llm'
import { clusterArticles } from '$lib/cluster'
import { supabaseAdmin } from '$lib/server/supabase'

const TRENDING_WINDOW_HOURS = 4
const CANDIDATE_LIMIT = 20                      // max clusters to send to LLM
const PICK_COUNT = 3                            // stories to select

const SYSTEM_PROMPT = `You are the story curator for WW3Watch — a real-time tracker of escalating global conflicts: wars, military strikes, assassinations, nuclear threats, coups, and major geopolitical crises.

You will receive a numbered list of news clusters. Each entry shows the headline, number of sources covering it, and how old it is.

Pick the ${PICK_COUNT} most geopolitically significant, actively-developing stories that users should see right now.

Prioritize: active combat, imminent WMD/nuclear threats, assassinations, regime changes, major escalations with new developments.
De-prioritize: background tensions at equilibrium, diplomatic statements with no action, economic news, old ongoing conflicts with no new development.

Return ONLY a JSON array of ${PICK_COUNT} integers (0-indexed positions from the list). No explanation. No markdown. Example: [2, 0, 11]`

export async function updateTrending(): Promise<void> {
  const since = new Date(Date.now() - TRENDING_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const { data: recent, error: dbError } = await supabaseAdmin
    .from('articles')
    .select('*')
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(500)

  if (dbError || !recent?.length) {
    console.error('[trending] Failed to fetch recent articles:', dbError)
    return
  }

  const now = Date.now()
  const clusters = clusterArticles(recent)
    .sort((a, b) => b.sourceCount - a.sourceCount)
    .slice(0, CANDIDATE_LIMIT)

  if (clusters.length === 0) return

  const userContent = clusters
    .map((c, i) => {
      const ageMin = c.representative.published_at
        ? Math.round((now - new Date(c.representative.published_at).getTime()) / 60000)
        : 0
      return `${i}. [${c.sourceCount} source${c.sourceCount === 1 ? '' : 's'}, ${ageMin}m ago] "${c.representative.title}"`
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
      !parsed.every((v): v is number => typeof v === 'number' && v >= 0 && v < clusters.length)
    ) {
      throw new Error(`Bad LLM response: ${text}`)
    }

    indices = parsed as number[]
  } catch (err) {
    console.error('[trending] LLM selection failed, skipping update:', err)
    return // keep previous trending intact on failure
  }

  const rows = indices.map((clusterIdx, rank) => ({
    article_id: clusters[clusterIdx].representative.id,
    rank,
    selected_at: new Date().toISOString(),
  }))

  await supabaseAdmin.from('trending').delete().neq('article_id', '')
  const { error } = await supabaseAdmin.from('trending').insert(rows)
  if (error) console.error('[trending] Supabase insert error:', error)
  else console.log(`[trending] Updated: ${rows.map(r => r.article_id).join(', ')}`)
}
