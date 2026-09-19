import { callLLM, LLMDeadlineError } from './llm'
import { groupByStoryId, wireDuplicateIds } from '../cluster'
import type { Cluster } from '../cluster'
import { supabaseAdmin } from './supabase'
import { jevEnabled } from './jev-classify'
import { rankWithJev } from './trending-jev'

const TRENDING_WINDOW_HOURS = 4
const CANDIDATE_LIMIT = 20                      // max clusters to judge
const PICK_COUNT = 3                            // stories to select
// Don't re-curate a selection younger than this. The pipeline now chains itself
// every ~15 min (pipeline.yml); a curation call per run would be ~100 LLM
// calls/day for a 4-hour window that barely moves between runs, and every one
// of them competes with classify for the provider's daily token budget.
export const TRENDING_MIN_INTERVAL_MS = 30 * 60_000
// A selection older than this while the run keeps reporting error:* means
// trending is STUCK, not quiet — the pipeline fails the run so the GitHub issue
// fires. Without it replace_trending failed on every run for four weeks
// (stats.trending='error:rpc') and nothing said a word; the site showed no
// Trending section the whole time.
export const TRENDING_STUCK_MS = 6 * 3600_000

const SYSTEM_PROMPT = `You are the story curator for WW3Watch — a real-time tracker of escalating global conflicts: wars, military strikes, assassinations, nuclear threats, coups, and major geopolitical crises.

You will receive a numbered list of news clusters. Each entry shows the headline, how many INDEPENDENT sources cover it (wire reprints already collapsed), across how many distinct regions and languages, and how old it is.

Pick the ${PICK_COUNT} most geopolitically significant, actively-developing stories that users should see right now.

Prioritize: active combat, imminent WMD/nuclear threats, assassinations, regime changes, major escalations with new developments. Multi-region, multi-language corroboration is the strongest signal a story is both real and globally significant — prefer it over a story echoed by many same-region outlets.
De-prioritize: background tensions at equilibrium, diplomatic statements with no action, economic news, old ongoing conflicts with no new development, single-source or single-region claims no one else has picked up.

Return ONLY a JSON array of ${PICK_COUNT} integers (0-indexed positions from the list). No explanation. No markdown. Example: [2, 0, 11]`

// When the current selection was written (null = no selection). Null on a query
// error too: the caller treats "can't read it" the same as "never written",
// which errs toward re-curating and toward alerting.
export async function lastTrendingSelectedAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('trending')
    .select('selected_at')
    .order('selected_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[trending] selected_at lookup failed:', error)
    return null
  }
  return (data?.selected_at as string | undefined) ?? null
}

// True when this run's trending status is an error AND the live selection is
// older than TRENDING_STUCK_MS (or missing). One failed run is noise; a failed
// run on top of a selection nobody has replaced for hours is an outage.
export function trendingStuck(status: string, lastSelectedAt: string | null, now: number): boolean {
  if (!status.startsWith('error:')) return false
  if (!lastSelectedAt) return true
  return now - new Date(lastSelectedAt).getTime() > TRENDING_STUCK_MS
}

// Returns a short status string for pipeline_runs.stats (so chronic trending-LLM
// failure is visible, not just stale selected_at values): 'updated:N' | 'empty'
// | 'fresh:skipped' | 'deferred:budget' | 'error:fetch|llm|rpc'.
//
// `deadlineMs` is the run's absolute wall-clock ceiling. Without it this call
// sat OUTSIDE the budget guard entirely: run 474 slept a provider-requested
// 149s here, and a larger retry-after would have pushed the job back into the
// 20-minute kill the budget exists to prevent. Curation is the most deferrable
// work in the run — a stale selection for one cycle beats losing the inserts.
export async function updateTrending(deadlineMs?: number): Promise<string> {
  const lastSelectedAt = await lastTrendingSelectedAt()
  if (lastSelectedAt && Date.now() - new Date(lastSelectedAt).getTime() < TRENDING_MIN_INTERVAL_MS) {
    console.log(`[trending] selection from ${lastSelectedAt} is fresh, skipping`)
    return 'fresh:skipped'
  }

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
      return { c, independent, regions, langs, wire }
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

  // With PICK_COUNT or fewer candidates the selection is forced — there is
  // nothing to curate. Skip the LLM entirely.
  //
  // This was a deadlock: the validation below demands exactly PICK_COUNT
  // DISTINCT indices in [0, clusters.length), which 1 or 2 candidates can never
  // satisfy. Every run spent a call, failed validation, logged error:llm and
  // kept a stale selection — indefinitely, since a quiet window does not fix
  // itself. Reachable at cold start, after an ingestion outage, or in any
  // genuinely quiet 4-hour window.
  //
  // `scored` is already sorted by independent source count descending, so
  // taking them in order is the same ranking the curator is asked to refine.
  if (clusters.length <= PICK_COUNT) {
    console.log(`[trending] ${clusters.length} candidate(s) — selection is forced, skipping the LLM`)
    return await writeTrending(clusters, clusters.map((_, i) => i))
  }

  // Jev first: three narrow judgments per story, weighed in code
  // (trending-jev.ts). No daily token cap, ~1s for all candidates — so trending
  // no longer queues behind the LLM's rate limit. The LLM curator below is the
  // fallback when Jev is off or could not judge enough candidates.
  if (jevEnabled()) {
    const ranked = await rankWithJev(
      scored.map((s) => ({
        headline: s.c.representative.title,
        otherHeadlines: s.c.articles
          .filter((a) => a.id !== s.c.representative.id && !s.wire.has(a.id))
          .map((a) => a.title),
        independent: s.independent,
        regions: s.regions,
        langs: s.langs,
      })),
      PICK_COUNT,
      deadlineMs,
    ).catch((err) => {
      console.error('[trending] jev ranking failed, falling back to the LLM:', err)
      return null
    })
    if (ranked) {
      console.log(`[trending] jev picks (score): ${ranked.indices.map((i, r) => `${i}=${ranked.scores[r]}`).join(', ')}`)
      return await writeTrending(clusters, ranked.indices)
    }
  }

  let indices: number[]
  try {
    // The answer is a tiny index array, but reasoning models (gpt-oss) spend
    // thinking tokens from the same max_tokens budget — leave headroom.
    const clean = await callLLM(
      [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
      512,
      deadlineMs,
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
    // Out of budget is not the LLM being down. Conflating them would make every
    // busy run look like a provider outage — the same distinction classify draws
    // between skippedBatches and failedBatches.
    if (err instanceof LLMDeadlineError) {
      console.warn('[trending] out of run budget, keeping previous selection')
      return 'deferred:budget'
    }
    console.error('[trending] LLM selection failed, skipping update:', err)
    return 'error:llm' // keep previous trending intact on failure
  }

  return await writeTrending(clusters, indices)
}

// Commit a selection: atomically overwrite `trending` and append the trail to
// trending_log in a single transaction via replace_trending RPC.
async function writeTrending(clusters: Cluster[], indices: number[]): Promise<string> {
  const rows = indices.map((clusterIdx, rank) => ({
    // article_id stays the newest member's id — bit-identical to the
    // pre-stories value, which N-1 clients resolve by membership. New clients
    // resolve by story_id directly (null for unassigned singletons).
    article_id: clusters[clusterIdx].representative.id,
    story_id: clusters[clusterIdx].storyId,
    rank,
    selected_at: new Date().toISOString(),
  }))

  // Denormalize the display fields for trending_log so they survive article pruning.
  const logPicks = indices.map((clusterIdx, rank) => {
    const rep = clusters[clusterIdx].representative
    return {
      article_id: rep.id,
      story_id: clusters[clusterIdx].storyId,
      rank,
      title: rep.title,
      source_name: rep.source_name,
      source_region: rep.source_region,
    }
  })

  const { error } = await supabaseAdmin.rpc('replace_trending', {
    p_rows: rows,
    p_log_picks: logPicks,
  })

  if (error) {
    console.error('[trending] replace_trending RPC error:', error)
    return 'error:rpc'
  }

  console.log(`[trending] Updated: ${rows.map((r) => r.article_id).join(', ')}`)
  return `updated:${rows.length}`
}
