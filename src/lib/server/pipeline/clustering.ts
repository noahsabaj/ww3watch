// Story grouping: embed unassigned titles, judge grey-band candidates with Jev,
// assign via the pgvector RPC, re-elect representatives.
import { embedTitles, shouldEmbed, EMBEDDING_MODEL_TAG, EMBED_SIM_THRESHOLD, EMBED_WINDOW_HOURS } from '../embeddings'
import { judgeSameEvent } from '../jev-pairs'
import { mapPool } from '../pool'
import { supabaseAdmin } from '../supabase'
import { ASSIGN_CAP, ASSIGN_LOOKBACK_HOURS, ASSIGN_RPC_CHUNK, ID_QUERY_CHUNK, JEV_CONCURRENCY, PAIR_BAND, PAIR_CHUNK } from '../config'
import { bump, type RunStats } from './stats'

// Embeds unassigned recent titles and assigns stories via the
// assign_story_by_embedding RPC (star linkage against story representatives,
// item-relative ±EMBED_WINDOW_HOURS window). Failure here never fails the run:
// articles stay story_id NULL and the next run picks them up.
// A `type`, not an `interface`: only type aliases are assignable to the generated
// `Json` (an index-signature type) that RPC arguments are declared as.
type AssignItem = {
  id: string
  published_at: string | null
  embedding: number[]
  join_story?: string
  avoid_story?: string
  min_sim?: number
}

// Similarity says "same subject"; only a judgment says "same event". For every
// item whose nearest story sits in the grey band, ask Jev and pass the verdict
// to assign_story_by_embedding as a hint (20260919020000_story_pair_judge.sql).
// Outside the band, and on any failure, the plain threshold decides as before.
//
// Called per chronological chunk (PAIR_CHUNK), so candidates include stories
// created earlier in the same run; only items inside one chunk still meet by
// threshold alone.
async function judgeGreyBand(items: AssignItem[], titleById: Map<string, string>, stats: RunStats): Promise<void> {
  try {
    const grey: Array<{ item: AssignItem; storyId: string; repTitle: string }> = []
    for (let i = 0; i < items.length; i += ASSIGN_RPC_CHUNK) {
      const { data, error } = await supabaseAdmin.rpc('nearest_story_candidates', {
        p_items: items.slice(i, i + ASSIGN_RPC_CHUNK).map(({ id, published_at, embedding }) => ({ id, published_at, embedding })),
        p_window_hours: EMBED_WINDOW_HOURS,
      })
      if (error) throw new Error(`nearest_story_candidates failed: ${JSON.stringify(error)}`)
      const byId = new Map(items.map((it) => [it.id, it]))
      for (const r of data ?? []) {
        const item = byId.get(r.r_article_id)
        if (!item || !r.r_story_id || !r.r_rep_title || r.r_sim === null) continue
        if (r.r_sim >= PAIR_BAND.lo && r.r_sim < PAIR_BAND.hi) grey.push({ item, storyId: r.r_story_id, repTitle: r.r_rep_title })
      }
    }
    let same = 0, different = 0, unsure = 0
    const judged = await mapPool(grey, JEV_CONCURRENCY, (g) => judgeSameEvent(titleById.get(g.item.id) ?? '', g.repTitle))
    for (const { item: g, value } of judged.done) {
      if (value.verdict === 'same') { g.item.join_story = g.storyId; same++ }
      else if (value.verdict === 'different') { g.item.avoid_story = g.storyId; g.item.min_sim = PAIR_BAND.hi; different++ }
      else unsure++
    }
    const failed = judged.failed.length
    bump(stats, 'pairs_judged', grey.length)
    bump(stats, 'pairs_same', same)
    bump(stats, 'pairs_different', different)
    bump(stats, 'pairs_unsure', unsure)
    bump(stats, 'pairs_failed', failed)
  } catch (err) {
    console.error('[pipeline] pair judge FAILED (threshold decides, as before):', err)
    stats.pairs_error = String(err).slice(0, 300)
  }
}

// Runs twice on a run with head accepts (early, then in finalize), so its
// counters accumulate rather than overwrite.
export async function embedAndAssignClusters(stats: RunStats): Promise<void> {
  try {
    const since = new Date(Date.now() - ASSIGN_LOOKBACK_HOURS * 3600_000).toISOString()
    const { data: newestFirst, error: qError } = await supabaseAdmin
      .from('articles')
      .select('id, title, published_at')
      .is('story_id', null)
      .gte('fetched_at', since)
      // Take the NEWEST when the worklist exceeds the cap: a backlog (a failed
      // run, or scripts/repair-stories.ts detaching wrong merges) must never make
      // a just-published article wait behind it. The backlog drains afterwards.
      .order('published_at', { ascending: false, nullsFirst: true })
      .limit(ASSIGN_CAP)
    if (qError) throw new Error(`worklist query failed: ${JSON.stringify(qError)}`)
    // Chronological ASC for the RPC, so later items can join clusters started by
    // earlier ones in the same call; null published_at last (anchors to now()).
    const unassigned = newestFirst ? [...newestFirst].reverse() : newestFirst
    if (!unassigned?.length) {
      bump(stats, 'embedded', 0)
      bump(stats, 'clusters_assigned', 0)
      return
    }

    const embeddable = unassigned.filter((a) => shouldEmbed(a.title))
    const skipped = unassigned.length - embeddable.length
    bump(stats, 'embed_skipped', skipped)

    // Articles embedded by a previous run whose assignment failed: reuse the
    // stored vector instead of re-embedding.
    const stored = new Map<string, number[]>()
    for (let i = 0; i < embeddable.length; i += ID_QUERY_CHUNK) {
      const ids = embeddable.slice(i, i + ID_QUERY_CHUNK).map((a) => a.id)
      const { data, error } = await supabaseAdmin
        .from('article_embeddings')
        .select('article_id, embedding')
        .in('article_id', ids)
      if (error) throw new Error(`stored-embedding fetch failed: ${JSON.stringify(error)}`)
      for (const r of data ?? []) {
        stored.set(r.article_id, typeof r.embedding === 'string' ? JSON.parse(r.embedding) : r.embedding)
      }
    }

    const toEmbed = embeddable.filter((a) => !stored.has(a.id))
    const fresh = await embedTitles(toEmbed.map((a) => a.title))
    const vecById = new Map<string, number[]>(stored)
    toEmbed.forEach((a, i) => vecById.set(a.id, fresh[i]))
    bump(stats, 'embedded', fresh.length)

    const items: AssignItem[] = embeddable
      .filter((a) => vecById.has(a.id))
      .map((a) => ({ id: a.id, published_at: a.published_at, embedding: vecById.get(a.id)! }))
    const titleById = new Map(embeddable.map((a) => [a.id, a.title]))
    let assigned = 0
    let newClusters = 0
    const joined = new Set<string>()
    // Judge, then assign, one chronological chunk at a time: the stories chunk N
    // creates are judged candidates for chunk N+1.
    for (let i = 0; i < items.length; i += PAIR_CHUNK) {
      const chunk = items.slice(i, i + PAIR_CHUNK)
      await judgeGreyBand(chunk, titleById, stats)
      const { data, error } = await supabaseAdmin.rpc('assign_story_by_embedding', {
        p_items: chunk,
        p_model: EMBEDDING_MODEL_TAG,
        p_threshold: EMBED_SIM_THRESHOLD,
        p_window_hours: EMBED_WINDOW_HOURS,
      })
      if (error) throw new Error(`assign RPC failed: ${JSON.stringify(error)}`)
      const rows = data ?? []
      assigned += rows.length
      newClusters += rows.filter((r) => r.r_is_new).length
      for (const r of rows) if (!r.r_is_new) joined.add(r.r_story_id)
    }
    // A story that grew gets its representative re-elected (the medoid), so what
    // later articles are compared against is the story's centre, not whichever
    // article happened to arrive first. Best-effort.
    if (joined.size > 0) {
      const { data, error } = await supabaseAdmin.rpc('reelect_story_reps', { p_story_ids: [...joined] })
      if (error) console.error('[pipeline] rep re-election failed (non-fatal):', error)
      else bump(stats, 'reps_reelected', Number(data) || 0)
    }
    bump(stats, 'clusters_assigned', assigned)
    bump(stats, 'clusters_new', newClusters)
    console.log(
      `[pipeline] clustering: embedded ${fresh.length} (reused ${stored.size}, skipped ${skipped}), ` +
        `assigned ${assigned} -> ${newClusters} new clusters (threshold ${EMBED_SIM_THRESHOLD}) | ` +
        `pairs judged ${stats.pairs_judged ?? 0}: ${stats.pairs_same ?? 0} same, ${stats.pairs_different ?? 0} different`,
    )
  } catch (err) {
    // Degradation contract: a failed clustering pass never fails the run.
    console.error('[pipeline] clustering FAILED (articles stay unassigned; next run self-heals):', err)
    stats.cluster_error = String(err).slice(0, 300)
  }
}
