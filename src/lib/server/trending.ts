import { groupByStoryId, wireDuplicateIds } from '../cluster'
import type { Cluster } from '../cluster'
import { supabaseAdmin } from './supabase'
import { rankWithJev } from './trending-jev'

const TRENDING_WINDOW_HOURS = 4
const CANDIDATE_LIMIT = 20                      // max clusters to judge
const PICK_COUNT = 3                            // stories to select
// Don't re-rank a selection younger than this. Ranking is ~20 Jev calls and
// about a second, so this is not about cost: a top-three that reshuffles on
// every run reads as noise, and the 4-hour window barely moves in 10 minutes.
export const TRENDING_MIN_INTERVAL_MS = 10 * 60_000
// A selection older than this while the run keeps reporting error:* means
// trending is STUCK, not quiet — the pipeline fails the run so the GitHub issue
// fires. Without it replace_trending failed on every run for four weeks
// (stats.trending='error:rpc') and nothing said a word; the site showed no
// Trending section the whole time.
export const TRENDING_STUCK_MS = 6 * 3600_000

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

// Returns a short status string for pipeline_runs.stats (so chronic trending
// failure is visible, not just stale selected_at values): 'updated:N' | 'empty'
// | 'fresh:skipped' | 'deferred:budget' | 'error:fetch|jev|rpc'.
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
  // once — and count region/language breadth so the ranking can reward genuine
  // cross-region corroboration over same-region echo.
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

  // With PICK_COUNT or fewer candidates the selection is forced — there is
  // nothing to rank. Skip Jev entirely.
  //
  // `scored` is already sorted by independent source count descending, so
  // taking them in order is the same ranking the curator is asked to refine.
  if (clusters.length <= PICK_COUNT) {
    console.log(`[trending] ${clusters.length} candidate(s) — selection is forced, nothing to rank`)
    return await writeTrending(clusters, clusters.map((_, i) => i))
  }

  // Curation is the most deferrable work in the run — a stale selection for one
  // cycle beats pushing the job toward its kill.
  if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
    console.warn('[trending] out of run budget, keeping previous selection')
    return 'deferred:budget'
  }

  // Three narrow judgments per story from Jev, weighed in code against the
  // corroboration counts computed above (trending-jev.ts). On failure the
  // previous selection stays: a wrong top-three is worse than a stale one.
  const ranked = await rankWithJev(
    scored.map((s) => ({
      headline: s.c.representative.title,
      // Distinct headlines only: the representative can itself be a wire
      // reprint, in which case the original carries the same title.
      otherHeadlines: [
        ...new Set(
          s.c.articles
            .filter((a) => a.id !== s.c.representative.id && !s.wire.has(a.id))
            .map((a) => a.title),
        ),
      ].filter((t) => t !== s.c.representative.title),
      independent: s.independent,
      regions: s.regions,
      langs: s.langs,
    })),
    PICK_COUNT,
    deadlineMs,
  ).catch((err) => {
    console.error('[trending] jev ranking failed:', err)
    return null
  })
  if (!ranked) {
    console.error('[trending] too few candidates judged, keeping previous selection')
    return 'error:jev'
  }
  console.log(`[trending] picks (score): ${ranked.indices.map((i, r) => `${i}=${ranked.scores[r]}`).join(', ')}`)
  return await writeTrending(clusters, ranked.indices)
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
