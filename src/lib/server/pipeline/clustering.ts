// Story grouping: embed unassigned titles, judge grey-band candidates with Jev,
// assign via the pgvector RPC, re-elect representatives.
import { embedTitles, shouldEmbed, EMBEDDING_MODEL_TAG, EMBED_SIM_THRESHOLD, EMBED_WINDOW_HOURS } from '../embeddings'
import { judgeSameEvent } from '../jev-pairs'
import { mapPool } from '../pool'
import { supabaseAdmin } from '../supabase'
import { STORY_MERGE } from '../config'
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

// Stories can merge. An article joins a story, but two STORIES about one event
// stayed apart forever — each article met the other's representative below the
// judged band, or arrived before the other story existed. Compare the
// representatives of active stories, ask Jev about the close pairs, fold the
// smaller into the larger. Same contract as the rest of this file: failure never
// fails the run, and "unsure" changes nothing.
//
// A pair is asked about once. "Different" and "unsure" are remembered in
// story_merge_judged under the two representatives, so the next run asks about
// the next-closest pairs instead of the same ones again; a story that elects a
// new representative has changed, and makes a new pair. "Same" is not
// remembered: it merges now, or is asked again next run.
export async function mergeStories(stats: RunStats): Promise<void> {
  try {
    // Nothing older than the window can be a candidate again.
    const forget = new Date(Date.now() - 2 * STORY_MERGE.hours * 3600_000).toISOString()
    await supabaseAdmin.from('story_merge_judged').delete().lt('judged_at', forget)

    const { data, error } = await supabaseAdmin.rpc('story_merge_candidates', {
      p_hours: STORY_MERGE.hours, p_min_sim: STORY_MERGE.minSim, p_limit: STORY_MERGE.candidates,
    })
    if (error) throw new Error(`story_merge_candidates failed: ${JSON.stringify(error)}`)
    const pairs = data ?? []
    if (pairs.length === 0) return
    const judged = await mapPool(pairs, JEV_CONCURRENCY, (p) => judgeSameEvent(p.r_a_title, p.r_b_title))
    bump(stats, 'merge_pairs_judged', judged.done.length)

    const settled = judged.done
      .filter((j) => !(j.value.verdict === 'same' && j.value.p >= STORY_MERGE.minP))
      .map(({ item: p, value }) => ({
        rep_a: p.r_a_rep < p.r_b_rep ? p.r_a_rep : p.r_b_rep,
        rep_b: p.r_a_rep < p.r_b_rep ? p.r_b_rep : p.r_a_rep,
        // A "same" below the merge bar is as good as unsure.
        verdict: value.verdict === 'different' ? 'different' : 'unsure',
      }))
    if (settled.length > 0) {
      const { error: memoryError } = await supabaseAdmin
        .from('story_merge_judged')
        .upsert(settled, { onConflict: 'rep_a,rep_b', ignoreDuplicates: true })
      if (memoryError) console.error('[pipeline] story_merge_judged write failed (non-fatal):', memoryError)
    }

    // Highest similarity first (the RPC's order); a story already folded away —
    // or folded INTO — this run is left for the next run, when its
    // representative and counts are settled again.
    const touched = new Set<string>()
    let merged = 0
    const same = judged.done
      .filter((j) => j.value.verdict === 'same' && j.value.p >= STORY_MERGE.minP)
      .sort((x, y) => y.item.r_sim - x.item.r_sim)
    for (const { item: p } of same) {
      if (merged >= STORY_MERGE.maxPerRun) break
      if (touched.has(p.r_a) || touched.has(p.r_b)) continue
      const [from, into] = p.r_a_count <= p.r_b_count ? [p.r_a, p.r_b] : [p.r_b, p.r_a]
      const { data: moved, error: mergeError } = await supabaseAdmin.rpc('merge_stories', { p_from: from, p_into: into })
      if (mergeError) { console.error('[pipeline] merge_stories failed (non-fatal):', mergeError); continue }
      touched.add(p.r_a).add(p.r_b)
      if ((moved ?? 0) > 0) {
        merged++
        console.log(`[pipeline] merged story "${(from === p.r_a ? p.r_a_title : p.r_b_title).slice(0, 60)}" into "${(into === p.r_a ? p.r_a_title : p.r_b_title).slice(0, 60)}" (sim ${p.r_sim.toFixed(3)}, ${moved} articles)`)
      }
    }
    if (merged > 0) {
      bump(stats, 'stories_merged', merged)
      await supabaseAdmin.rpc('reelect_story_reps', { p_story_ids: [...touched] })
    }
  } catch (err) {
    console.error('[pipeline] story merge FAILED (stories stay as they are):', err)
    stats.merge_error = String(err).slice(0, 300)
  }
}
