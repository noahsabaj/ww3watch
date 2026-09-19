// WW3Watch ingestion pipeline — runs on a schedule via GitHub Actions
// (.github/workflows/pipeline.yml) or locally with: node --import tsx scripts/run-pipeline.ts
//
// Replaces the old GET /api/cron serverless route. Reuses the same logic from
// src/lib/server/*, which now reads config from process.env (see env.ts).
//
// Pipeline: fetch all feeds -> de-dup (within run + against DB+rejects) ->
// classify only NEW articles (local relevance head first, Jev for the uncertain
// band) -> upsert + record rejects -> embed titles + assign clusters
// (multilingual embeddings, assign_clusters_by_embedding RPC) -> recompute
// trending. Every run writes one pipeline_runs row (stats jsonb
// + error) for dashboard observability.

import { fetchFeed, FEED_ERROR_KINDS, type FeedFetchResult, type FeedErrorKind } from '../src/lib/server/rss'
import type { Feed } from '../src/lib/types'
import { askSignals } from '../src/lib/server/jev-signals'
import { judgeSameEvent, PAIR_BAND } from '../src/lib/server/jev-pairs'
import { jevEnabled, partitionByJev, JEV_THRESHOLD } from '../src/lib/server/jev-classify'
import {
  embedTitles,
  shouldEmbed,
  EMBEDDING_MODEL_TAG,
  EMBED_SIM_THRESHOLD,
  EMBED_WINDOW_HOURS,
} from '../src/lib/server/embeddings'
import { updateTrending, lastTrendingSelectedAt, trendingStuck } from '../src/lib/server/trending'
import { existingGuids } from '../src/lib/server/dedupe'
import { selectStaleWriteOffs, staleRejectRow } from '../src/lib/server/backlog'
import { loadHead, headScore, partitionByHead, auditAgreement } from '../src/lib/server/prefilter'
import { supabaseAdmin } from '../src/lib/server/supabase'
import { appendFileSync } from 'node:fs'

const UPSERT_BATCH = 200
// Wall-clock budget for the whole run, and the share of it classify may spend.
//
// The job's timeout-minutes is a KILL, not a budget: a run that hits it dies
// mid-classify having written nothing — no inserts, no recorded rejects — so the
// identical backlog returns next run and the next run dies the same way. That is
// how 38 of 40 scheduled runs went, silently, because a job killed by
// timeout-minutes reports "cancelled" and if: failure() never fires.
//
// So the run bounds ITSELF, below the kill, and classify stops STARTING work
// when its share is gone. Unclassified articles stay "new" and are picked up
// next run — the same deferral the per-run cap already relies on. The remaining
// minutes belong to the stages after classify, which are what actually persist
// the run's work.
const RUN_BUDGET_MS = Number(process.env.RUN_BUDGET_MS || '') || 15 * 60_000
const CLASSIFY_BUDGET_MS = Number(process.env.CLASSIFY_BUDGET_MS || '') || 9 * 60_000
// The local relevance head (src/lib/server/prefilter.ts) scores up to this
// many new articles per run — embedding is local and cheap (~25/s on the
// runner), so the pool is sized for draining a backlog, not for a quiet run.
// Only the uncertain band goes on to Jev.
const HEAD_POOL_CAP = Number(process.env.HEAD_POOL_CAP || '') || 2000
// Accepted articles Jev annotates per run (topic, severity, claim status, actors
// — src/lib/signals.ts). A worklist, so a backlog or an outage drains over the
// following runs instead of being lost.
const SIGNALS_CAP = Number(process.env.SIGNALS_CAP || '') || 600
const SIGNALS_LOOKBACK_HOURS = 48
const SIGNALS_CONCURRENCY = 16
// The signals request also returns Jev's P(relevant) for the article. The local
// head's accepts never passed Jev's relevance gate, so this is their second
// opinion, for free: below this, the article is removed again (its guid goes to
// classified_rejects). Deliberately far below the 0.5 accept cut — two judges
// disagreeing mildly is not grounds to delete — and capped per run, so a bad
// question edit cannot empty the feed before someone notices.
const PURGE_BELOW = Number(process.env.PURGE_BELOW || '') || 0.2
const PURGE_CAP_PER_RUN = 25
// Grey-band judging + assignment happen in chronological chunks this size, so an
// article can be JUDGED against a story created moments earlier in the same run
// (within one chunk, items still meet by threshold alone).
const PAIR_CHUNK = 20
// Feeds that fetch fine but almost never yield an accepted article.
const LOW_YIELD = { days: 7, minItems: 100, maxPct: 2 }
// Jev (TypeSafe) judges up to this many of the still-unsettled articles per run.
// No daily cap and ~150ms a call, so the bound is wall-clock, not quota.
const JEV_POOL_CAP = Number(process.env.JEV_POOL_CAP || '') || 2000
// Share of confident head verdicts that Jev judges anyway, so the head's live
// agreement is measured every run (stats.cls_head.audit_agreement) instead of
// trusted from its training holdout.
const HEAD_AUDIT_RATE = Number(process.env.HEAD_AUDIT_RATE || '') || 0.03
// Consecutive failed fetches after which a source is switched off. With a run
// every ~15 min this is roughly two days of solid failure — a moved feed URL or
// a WAF that now blocks the runner and the proxy alike, not a bad afternoon.
// Disabled sources are listed in stats.sources_disabled and the workflow files
// a feed-health issue so a person re-curates (curation is SQL, not commits).
const AUTO_DISABLE_AFTER = Number(process.env.AUTO_DISABLE_AFTER || '') || 200
// Past the cap, an article this old is written off unjudged rather than deferred
// forever. Sized against what the product can actually show: the feed serves the
// newest 500 articles, which even at a healthy accept rate is well under a day
// of content — so a verdict on a 48h-old item cannot change what anyone sees.
// Env-overridable to make draining an accumulated backlog a one-run operation.
const STALE_WRITEOFF_HOURS = Number(process.env.STALE_WRITEOFF_HOURS || '') || 48
// Clustering worklist: everything unassigned from the last day, capped. Covers
// this run's inserts AND articles from runs whose embed/assign step failed
// (self-heal — driven purely by story_id IS NULL, nothing is ever orphaned).
const ASSIGN_LOOKBACK_HOURS = 24
const ASSIGN_CAP = 300
const ASSIGN_RPC_CHUNK = 100
const ID_QUERY_CHUNK = 100 // .in() filters travel in the URL — keep chunks small

type RunStats = Record<string, unknown>

// A sources-table row: the fetchable Feed shape plus health bookkeeping.
type SourceRow = Feed & {
  id: string
  enabled: boolean
  consecutive_failures: number
}

// The roster lives in the DB (sources table). A failed/empty roster query must
// FAIL the run loudly — a silent zero-feed "success" would record error=null
// and reset the freshness dead-man's switch.
async function loadSources(): Promise<SourceRow[]> {
  const { data, error } = await supabaseAdmin
    .from('sources')
    .select('*')
    .eq('enabled', true)
    // Deterministic order ⇒ deterministic guid-dedupe attribution for items
    // cross-posted to multiple feeds.
    .order('name')
  if (error) throw new Error(`sources roster query failed: ${JSON.stringify(error)}`)
  if (!data?.length) throw new Error('sources roster is empty — refusing to run')
  return data as SourceRow[]
}

// Write per-source health back after the fetch pass. Two homogeneous upserts
// (PostgREST requires uniform payload keys): successes reset the failure
// counter; failures increment it and record the kind/detail. A source crossing
// AUTO_DISABLE_AFTER consecutive failures is switched off here; its name is
// returned so the run can report it. Best-effort — health bookkeeping must
// never fail the run.
async function updateSourceHealth(results: FeedFetchResult[]): Promise<string[]> {
  const now = new Date().toISOString()
  const base = (s: SourceRow) => ({
    id: s.id,
    url: s.url,
    name: s.name,
    region: s.region,
    lang: s.lang,
    enabled: s.enabled,
    updated_at: now,
  })
  const ok = results
    .filter((r) => !r.error)
    .map((r) => ({
      ...base(r.feed as SourceRow),
      last_ok_at: now,
      last_via: r.via,
      consecutive_failures: 0,
      last_error_kind: null,
      last_error: null,
    }))
  const disabled: string[] = []
  const failed = results
    .filter((r) => r.error)
    .map((r) => {
      const feed = r.feed as SourceRow
      const consecutive = (feed.consecutive_failures ?? 0) + 1
      const stillEnabled = consecutive < AUTO_DISABLE_AFTER
      if (!stillEnabled) disabled.push(`${feed.name} (${r.error!.kind}: ${r.error!.detail.slice(0, 80)})`)
      return {
        ...base(feed),
        enabled: stillEnabled,
        consecutive_failures: consecutive,
        last_error_kind: r.error!.kind,
        // Feed error details can embed binary/HTML response snippets — Postgres
        // text rejects NUL (and friends); one bad row poisons the whole batch.
        last_error: r.error!.detail.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 300),
      }
    })
  for (const rows of [ok, failed]) {
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const { error } = await supabaseAdmin
        .from('sources')
        .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: 'id' })
      if (error) console.error('[pipeline] source health write failed:', error)
    }
  }
  if (disabled.length > 0) {
    console.warn(`[pipeline] auto-disabled ${disabled.length} source(s) after ${AUTO_DISABLE_AFTER} consecutive failures:`)
    for (const d of disabled) console.warn(`  - ${d}`)
    // Hand the list to the workflow so it can file the feed-health issue.
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `disabled_sources<<EOF\n${disabled.join('\n')}\nEOF\n`)
    }
  }
  return disabled
}

function logFeedSummary(results: FeedFetchResult[]) {
  const ok = results.filter((r) => !r.error)
  const direct = ok.filter((r) => r.via === 'direct').length
  const proxy = ok.filter((r) => r.via === 'proxy').length
  const failed = results.filter((r) => r.error)
  // Build the tally from the canonical kind list so it can't drift when a kind
  // is added (e.g. 'blocked').
  const byKind = Object.fromEntries(FEED_ERROR_KINDS.map((k) => [k, 0])) as Record<FeedErrorKind, number>
  for (const r of failed) byKind[r.error!.kind]++

  const datesClamped = results.reduce((sum, r) => sum + (r.clamped ?? 0), 0)

  const kindSummary = FEED_ERROR_KINDS.map((k) => `${k}=${byKind[k]}`).join(' ')
  console.log(
    `[pipeline] feeds ok ${ok.length}/${results.length} (direct ${direct}, proxy ${proxy}) | failed ${failed.length}: ${kindSummary}`,
  )
  for (const r of failed) {
    console.log(`[feed-fail] ${r.feed.name} [${r.feed.region}] ${r.error!.kind}: ${r.error!.detail}`)
  }
  if (datesClamped > 0) console.log(`[pipeline] clamped ${datesClamped} out-of-range pubDate(s) to null`)

  return {
    feeds_ok: ok.length,
    feeds_direct: direct,
    feeds_proxy: proxy,
    feeds_failed: failed.length,
    fail_kinds: byKind,
    dates_clamped: datesClamped,
  }
}

// Embeds unassigned recent titles and assigns stories via the
// assign_story_by_embedding RPC (star linkage against story representatives,
// item-relative ±EMBED_WINDOW_HOURS window). Failure here never fails the run:
// articles stay story_id NULL and the next run picks them up.
interface AssignItem {
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
  const bump = (key: string, n: number) => { stats[key] = (Number(stats[key]) || 0) + n }
  try {
    const grey: Array<{ item: AssignItem; storyId: string; repTitle: string }> = []
    for (let i = 0; i < items.length; i += ASSIGN_RPC_CHUNK) {
      const { data, error } = await supabaseAdmin.rpc('nearest_story_candidates', {
        p_items: items.slice(i, i + ASSIGN_RPC_CHUNK).map(({ id, published_at, embedding }) => ({ id, published_at, embedding })),
        p_window_hours: EMBED_WINDOW_HOURS,
      })
      if (error) throw new Error(`nearest_story_candidates failed: ${JSON.stringify(error)}`)
      const byId = new Map(items.map((it) => [it.id, it]))
      for (const r of (data ?? []) as Array<{ r_article_id: string; r_story_id: string | null; r_rep_title: string | null; r_sim: number | null }>) {
        const item = byId.get(r.r_article_id)
        if (!item || !r.r_story_id || !r.r_rep_title || r.r_sim === null) continue
        if (r.r_sim >= PAIR_BAND.lo && r.r_sim < PAIR_BAND.hi) grey.push({ item, storyId: r.r_story_id, repTitle: r.r_rep_title })
      }
    }
    let same = 0, different = 0, unsure = 0, failed = 0
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(16, grey.length) }, async () => {
        while (next < grey.length) {
          const g = grey[next++]
          try {
            const { verdict } = await judgeSameEvent(titleById.get(g.item.id) ?? '', g.repTitle)
            if (verdict === 'same') { g.item.join_story = g.storyId; same++ }
            else if (verdict === 'different') { g.item.avoid_story = g.storyId; g.item.min_sim = PAIR_BAND.hi; different++ }
            else unsure++
          } catch {
            failed++
          }
        }
      }),
    )
    bump('pairs_judged', grey.length)
    bump('pairs_same', same)
    bump('pairs_different', different)
    bump('pairs_unsure', unsure)
    bump('pairs_failed', failed)
  } catch (err) {
    console.error('[pipeline] pair judge FAILED (threshold decides, as before):', err)
    stats.pairs_error = String(err).slice(0, 300)
  }
}

// Runs twice on a run with head accepts (early, then in finalize), so its
// counters accumulate rather than overwrite.
async function embedAndAssignClusters(stats: RunStats): Promise<void> {
  const bump = (key: string, n: number) => { stats[key] = (Number(stats[key]) || 0) + n }
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
      bump('embedded', 0)
      bump('clusters_assigned', 0)
      return
    }

    const embeddable = unassigned.filter((a) => shouldEmbed(a.title))
    const skipped = unassigned.length - embeddable.length
    bump('embed_skipped', skipped)

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
    bump('embedded', fresh.length)

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
      const rows = (data ?? []) as Array<{ r_story_id: string; r_is_new: boolean }>
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
      else bump('reps_reelected', Number(data) || 0)
    }
    bump('clusters_assigned', assigned)
    bump('clusters_new', newClusters)
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

// Annotate accepted articles that have no signals yet (signals_at IS NULL).
// Same contract as clustering: failure never fails the run, the rows stay on
// the worklist, and the next run picks them up.
async function enrichSignals(stats: RunStats, deadlineMs: number): Promise<void> {
  if (!jevEnabled()) return
  const bump = (key: string, n: number) => { stats[key] = (Number(stats[key]) || 0) + n }
  try {
    const since = new Date(Date.now() - SIGNALS_LOOKBACK_HOURS * 3600_000).toISOString()
    const { data: pending, error } = await supabaseAdmin
      .from('articles')
      .select('id, title, summary, source_lang, jev_relevant')
      .is('signals_at', null)
      .gte('fetched_at', since)
      .order('fetched_at', { ascending: false })
      .limit(SIGNALS_CAP)
    if (error) throw new Error(`worklist query failed: ${JSON.stringify(error)}`)
    if (!pending?.length) return

    const items: Array<Record<string, unknown>> = []
    const irrelevant: string[] = []
    let failed = 0
    let tokens = 0
    let next = 0
    await Promise.all(
      Array.from({ length: Math.min(SIGNALS_CONCURRENCY, pending.length) }, async () => {
        while (next < pending.length && Date.now() < deadlineMs) {
          const a = pending[next++]
          try {
            // jev_relevant is already set for articles Jev itself accepted; only
            // the head's accepts still need the relevance question.
            const { inputTokens, ...signals } = await askSignals(a, deadlineMs, a.jev_relevant ?? null)
            tokens += inputTokens
            items.push({ id: a.id, ...signals })
            if (a.jev_relevant == null && signals.jev_relevant !== null && signals.jev_relevant < PURGE_BELOW) irrelevant.push(a.id)
          } catch (err) {
            failed++
            if (failed <= 3) console.error('[signals] jev call failed (article stays on the worklist):', String(err).slice(0, 200))
          }
        }
      }),
    )
    let applied = 0
    for (let i = 0; i < items.length; i += UPSERT_BATCH) {
      const { data, error: rpcError } = await supabaseAdmin.rpc('apply_article_signals', { p_items: items.slice(i, i + UPSERT_BATCH) })
      if (rpcError) throw new Error(`apply_article_signals failed: ${JSON.stringify(rpcError)}`)
      applied += Number(data) || 0
    }
    // Annotated FIRST, purged second: anything over the cap keeps its signals
    // (and its low jev_relevant on the record) instead of being re-asked forever.
    if (irrelevant.length > 0) {
      const { data, error: purgeError } = await supabaseAdmin.rpc('purge_irrelevant_articles', {
        p_ids: irrelevant.slice(0, PURGE_CAP_PER_RUN),
      })
      if (purgeError) console.error('[signals] purge failed (articles stay):', purgeError)
      else {
        bump('signals_purged', Number(data) || 0)
        console.log(`[pipeline] signals: removed ${Number(data) || 0} of ${irrelevant.length} accepted articles Jev puts below P(relevant) ${PURGE_BELOW}`)
      }
    }
    bump('signals_applied', applied)
    bump('signals_failed', failed)
    bump('signals_tokens', tokens)
    console.log(`[pipeline] signals: ${applied} articles annotated (${failed} failed, ${pending.length - items.length - failed} left for next run)`)
  } catch (err) {
    console.error('[pipeline] signals FAILED (articles stay un-annotated; next run self-heals):', err)
    stats.signals_error = String(err).slice(0, 300)
  }
}

// Feeds that fetch fine but almost never yield an accepted article. Fetch health
// cannot see these. Reported in stats every run; the workflow files a
// feed-health issue from the step output (at most one open issue, commented on).
async function reportLowYield(stats: RunStats): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin.rpc('source_yield', {
      p_days: LOW_YIELD.days, p_min_items: LOW_YIELD.minItems, p_max_pct: LOW_YIELD.maxPct,
    })
    if (error) throw new Error(JSON.stringify(error))
    const rows = (data ?? []) as Array<{ r_name: string; r_accepted: number; r_rejected: number; r_pct: number }>
    stats.low_yield_sources = rows.map((r) => ({ name: r.r_name, accepted: r.r_accepted, rejected: r.r_rejected }))
    if (rows.length > 0 && process.env.GITHUB_OUTPUT) {
      const lines = rows.map((r) => `${r.r_name}: ${r.r_accepted} accepted / ${r.r_rejected} rejected in ${LOW_YIELD.days}d (${Number(r.r_pct).toFixed(1)}%)`)
      appendFileSync(process.env.GITHUB_OUTPUT, `low_yield_sources<<EOF\n${lines.join('\n')}\nEOF\n`)
    }
  } catch (err) {
    console.error('[pipeline] low-yield report failed (non-fatal):', err)
  }
}

async function recordRun(startedAt: Date, stats: RunStats, error: unknown): Promise<void> {
  // Best-effort: a run-log failure must never fail the run (and a total
  // Supabase-connectivity fatal can't record itself — accepted).
  try {
    const { error: insertError } = await supabaseAdmin.from('pipeline_runs').insert({
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      error: error ? String(error).slice(0, 1000) : null,
      stats,
    })
    if (insertError) console.error('[pipeline] run-log write failed:', insertError)
  } catch (err) {
    console.error('[pipeline] run-log write failed:', err)
  }
}

// Operator health gate, read once per run. ops_health() returns DB size + the
// last retention-cron outcome. Runs at the END of a run: a tripped threshold
// must ALERT (fail the run → GitHub issue), never halt ingestion (already done).
async function checkOpsHealth(stats: RunStats): Promise<void> {
  let health: Record<string, unknown> | null = null
  try {
    const { data } = await supabaseAdmin.rpc('ops_health')
    health = (data as Record<string, unknown>) ?? null
  } catch (err) {
    console.error('[pipeline] ops_health check failed (non-fatal):', err)
  }
  if (!health) return
  stats.db = health
  const sizeMb = Number(health.db_size_mb) || 0
  const lastAt = health.retention_last_at ? new Date(health.retention_last_at as string).getTime() : 0
  if (!lastAt || Date.now() - lastAt > 48 * 3600_000) {
    console.error(`[pipeline] WARNING: retention has not succeeded in >48h (last: ${health.retention_last_at ?? 'never'})`)
  }
  if (sizeMb > 400) console.error(`[pipeline] WARNING: DB size ${sizeMb}MB (free-tier cap is 500MB)`)
  if (sizeMb > 450) {
    throw new Error(`DB size ${sizeMb}MB exceeds the 450MB ceiling (free tier is 500MB) — prune or upgrade`)
  }
}

// Local-model clustering + trending + the ops-health gate. Shared by the
// no-new-articles path and the main path so every run captures trending status
// and DB health (and self-heals clustering).
// Every reject path — Jev's verdicts, the head's confident rejects, and unjudged
// stale write-offs — goes through here so they can never drift in what they
// write. `reason` is the only thing that distinguishes them, and
// train-classifier.ts depends on it being accurate: it loads reason='jev' (and historical 'llm') as
// the negatives class, so a mislabelled row would train the head against a
// verdict no model ever gave (or against its own).
async function writeRejects(
  rows: Array<{ guid: string; title: string | null; source_id: string | null; lang: string | null; reason: 'stale' | 'head' | 'jev' }>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    const { error } = await supabaseAdmin
      .from('classified_rejects')
      .upsert(batch, { onConflict: 'guid', ignoreDuplicates: true })
    if (error) console.error('[pipeline] reject record error:', error)
  }
}

async function upsertArticles<T extends { guid: string }>(articles: T[]): Promise<number> {
  let inserted = 0
  for (let i = 0; i < articles.length; i += UPSERT_BATCH) {
    const batch = articles.slice(i, i + UPSERT_BATCH)
    const { data, error } = await supabaseAdmin
      .from('articles')
      .upsert(batch, { onConflict: 'guid', ignoreDuplicates: true })
      .select('id')
    if (error) console.error(`[pipeline] upsert error (batch ${Math.floor(i / UPSERT_BATCH) + 1}):`, error)
    else inserted += data?.length ?? 0
  }
  return inserted
}

async function finalize(stats: RunStats, startedAt: number): Promise<void> {
  const timings = (stats.timings ??= {}) as Record<string, number>
  const timed = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now()
    try {
      return await fn()
    } finally {
      timings[stage] = Date.now() - t0
    }
  }
  await timed('cluster', () => embedAndAssignClusters(stats))
  // Before trending, which ranks on these.
  await timed('signals', () => enrichSignals(stats, startedAt + RUN_BUDGET_MS))
  stats.trending = await timed('trending', () => updateTrending(startedAt + RUN_BUDGET_MS))
  await timed('ops_health', () => checkOpsHealth(stats))
  await reportLowYield(stats)
  stats.total_ms = Date.now() - startedAt
  console.log(`[pipeline] done in ${stats.total_ms}ms | stages ${JSON.stringify(timings)}`)

  // Loud failure for STUCK trending — after everything else has persisted, so
  // it alerts (freshness stays green: articles did land) without costing the
  // run's work. A single error:* is tolerated; error:* while the live selection
  // is hours old is not. replace_trending failed every run for four weeks with
  // only stats.trending saying so, and the site showed no Trending section.
  const trendingStatus = String(stats.trending ?? '')
  if (trendingStatus.startsWith('error:')) {
    const lastSelectedAt = await lastTrendingSelectedAt()
    if (trendingStuck(trendingStatus, lastSelectedAt, Date.now())) {
      throw new Error(
        `trending is stuck: this run reported ${trendingStatus} and the live selection is from ${lastSelectedAt ?? 'never'}`,
      )
    }
  }
}

async function run(stats: RunStats): Promise<void> {
  const startedAt = Date.now()
  // Per-stage wall-clock into pipeline_runs.stats.timings. Nothing measured the
  // shape of a run before, so "the pipeline is slow" could not be turned into
  // "which stage" without reading Actions logs by hand.
  const timings: Record<string, number> = {}
  const timed = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now()
    try {
      return await fn()
    } finally {
      timings[stage] = Date.now() - t0
      stats.timings = timings
    }
  }

  // 1. Load the roster from the DB, then fetch every feed in parallel;
  //    failures are recorded (and proxy-retried), never silently dropped.
  const sources = await timed('roster', () => loadSources())
  const settled = await timed('fetch', () => Promise.allSettled(sources.map((feed) => fetchFeed(feed))))
  const results: FeedFetchResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { feed: sources[i], via: 'direct', articles: [], error: { kind: 'network', detail: String(s.reason) } },
  )
  Object.assign(stats, logFeedSummary(results))
  stats.sources_disabled = await timed('source_health', () => updateSourceHealth(results))

  // Dead-man's switch: if EVERY feed failed (runner egress outage, proxy down,
  // DNS), a "no new articles" success would reset the freshness clock on the
  // exact failure class the readout exists for. Fail loudly — after the health
  // write (so per-source failures are recorded); recordRun fires via finally.
  if ((stats.feeds_ok as number) === 0) {
    throw new Error('all feeds failed to fetch — refusing to record a successful run')
  }

  const candidates = results.flatMap((r) => r.articles).filter((a) => a.guid !== '')

  // De-dup within this run: the same article can arrive from multiple feeds.
  const uniqueByGuid = [...new Map(candidates.map((a) => [a.guid, a])).values()]

  // 2. De-dup against the DB (kept articles UNION recorded rejects) so we only
  //    spend Jev tokens on genuinely-unseen articles.
  const existing = await timed('dedupe', () => existingGuids(uniqueByGuid.map((a) => a.guid)))
  const fresh = uniqueByGuid.filter((a) => !existing.has(a.guid))
  console.log(`[pipeline] ${candidates.length} items -> ${uniqueByGuid.length} unique -> ${fresh.length} new`)
  Object.assign(stats, { items: candidates.length, unique: uniqueByGuid.length, new: fresh.length })

  if (fresh.length === 0) {
    // Still run clustering: a previous run's embed/assign failure leaves
    // backlog that must heal even on quiet runs.
    console.log('[pipeline] no new articles; clustering self-heal + trending only')
    await finalize(stats, startedAt)
    return
  }

  // 3. Classify. Newest first, two tiers, no generative model anywhere:
  //      head — a local logistic layer over the title embedding settles the
  //             obvious mass for free (src/lib/server/prefilter.ts);
  //      Jev  — TypeSafe's decision model gives everything else a calibrated
  //             P(relevant) and the verdict is final (jev-classify.ts).
  //    An article Jev could not be asked about (call failed, run out of time)
  //    gets NO verdict: it stays "new" and is judged next run.
  const ordered = [...fresh].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
  const head = loadHead()
  let forJev: typeof ordered = ordered
  let headAccept: typeof ordered = []
  let headReject: typeof ordered = []
  let audit: Map<(typeof ordered)[number], 'accept' | 'reject' | 'uncertain'> = new Map()
  if (head) {
    const pool = ordered.slice(0, HEAD_POOL_CAP)
    const embeddable = pool.filter((a) => shouldEmbed(a.title))
    const vecs = await timed('head', () => embedTitles(embeddable.map((a) => a.title)))
    const part = partitionByHead(embeddable, vecs.map((v) => headScore(head, v)), head, { auditRate: HEAD_AUDIT_RATE })
    headAccept = part.accept
    headReject = part.reject
    audit = part.audit
    // Titles too short to embed get no head opinion — they go straight to Jev.
    forJev = [...part.uncertain, ...pool.filter((a) => !shouldEmbed(a.title)), ...ordered.slice(HEAD_POOL_CAP)]
      .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    stats.cls_head = {
      trained_at: head.trained_at,
      pool: pool.length,
      accept: headAccept.length,
      reject: headReject.length,
      uncertain: part.uncertain.length,
      audit: part.audit.size,
    }
    console.log(
      `[pipeline] head: ${pool.length} scored → accept ${headAccept.length}, reject ${headReject.length}, ` +
        `uncertain ${part.uncertain.length} (+${part.audit.size} audit) → Jev gets ${Math.min(forJev.length, JEV_POOL_CAP)}`,
    )
  }

  // The head's verdicts land first: they need nothing from the network.
  let inserted = 0
  if (headAccept.length > 0) {
    inserted += await timed('head_upsert', () => upsertArticles(headAccept))
    await timed('head_cluster', () => embedAndAssignClusters(stats))
    await timed('head_signals', () => enrichSignals(stats, startedAt + RUN_BUDGET_MS))
  }
  // Project explicit, homogeneous columns (never spread the article objects —
  // PostgREST 400s on unknown columns, and a batch needs uniform keys).
  // source_id + lang give the curation pass accept-rate per source/language;
  // reason keeps who said no on the record (the trainer never learns from 'head').
  const rejectRow = (a: (typeof ordered)[number], reason: 'head' | 'jev') => ({
    guid: a.guid, title: a.title, source_id: a.source_id ?? null, lang: a.source_lang ?? null, reason,
  })
  if (headReject.length > 0) await writeRejects(headReject.map((a) => rejectRow(a, 'head')))

  // Jev gets a share of the run's budget, measured from the START of the run so
  // a slow fetch eats into it rather than pushing past the job's kill.
  const jevPool = forJev.slice(0, JEV_POOL_CAP)
  const part = await timed('jev', () =>
    partitionByJev(jevPool, { deadlineMs: startedAt + Math.min(CLASSIFY_BUDGET_MS, RUN_BUDGET_MS) }),
  )
  const deferred = [...part.unjudged, ...forJev.slice(JEV_POOL_CAP)]
  stats.cls_jev = {
    pool: jevPool.length,
    accept: part.accept.length,
    reject: part.reject.length,
    // Verdicts that landed near the cut — the number to watch if the feed ever
    // looks too loose or too tight. They are still verdicts.
    borderline: part.borderline,
    unjudged: part.unjudged.length,
    failed: part.failed,
    input_tokens: part.inputTokens,
    threshold: JEV_THRESHOLD,
  }
  console.log(
    `[pipeline] jev: ${jevPool.length} sent → accept ${part.accept.length}, reject ${part.reject.length} ` +
      `(${part.borderline} borderline), ${part.unjudged.length} unjudged (${part.failed} failed)`,
  )

  inserted += await upsertArticles(part.accept)
  console.log(`[pipeline] inserted ${inserted} new articles`)
  stats.inserted = inserted
  if (part.reject.length > 0) await writeRejects(part.reject.map((a) => rejectRow(a, 'jev')))

  // Anything still unjudged that is already too old to display is written off.
  // "Deferred to next run" was a lie for nine days once: the deferred remainder
  // grew to 6,007 — permanently re-fetched, re-deduped and never reconsidered. A
  // verdict on a two-day-old article cannot change what anyone sees; the feed
  // serves the newest 500. Keeps `new` meaning "actually new".
  const stale = selectStaleWriteOffs(deferred, Date.now() - STALE_WRITEOFF_HOURS * 3_600_000)
  if (stale.length > 0) {
    await timed('stale_writeoff', () => writeRejects(stale.map(staleRejectRow)))
    console.log(
      `[pipeline] wrote off ${stale.length} unjudged articles older than ${STALE_WRITEOFF_HOURS}h (too old to display)`,
    )
  }
  stats.stale_written_off = stale.length
  if (deferred.length > stale.length) {
    console.log(`[pipeline] ${deferred.length - stale.length} articles stay new for the next run`)
  }

  Object.assign(stats, {
    // Articles that actually got a verdict this run, from either tier.
    classified: headAccept.length + headReject.length + part.accept.length + part.reject.length,
    deferred: deferred.length,
    relevant: headAccept.length + part.accept.length,
    rejected: headReject.length + part.reject.length,
  })
  if (head && audit.size > 0) {
    // The head's audit slice rode along to Jev; this is how often Jev agreed.
    const agreement = auditAgreement(
      audit,
      (a) => a.guid,
      new Set(part.accept.map((a) => a.guid)),
      new Set(part.reject.map((a) => a.guid)),
    )
    ;(stats.cls_head as Record<string, unknown>).audit_agreement = agreement
    console.log(
      `[pipeline] head audit: accept ${agreement.accept.agree}/${agreement.accept.n}, reject ${agreement.reject.agree}/${agreement.reject.n} agreed with Jev`,
    )
  }

  // 4/5/6. Embed + assign stories (story_id IS NULL worklist self-heals),
  //         annotate signals, recompute trending, read the ops-health gate.
  await finalize(stats, startedAt)

  // 7. Loud failure when Jev is DOWN — after the head's inserts and the
  //    clustering self-heal have persisted, so an outage degrades the run rather
  //    than dropping it, but the run still FAILS (freshness amber + GitHub issue)
  //    instead of laundering a near-empty result into a green one. A handful of
  //    failed calls is a hiccup; most of a real pool failing is an outage — and
  //    only on the second run in a row, so one bad minute never files an issue.
  const jevDown = jevPool.length >= 5 && part.failed > jevPool.length / 2
  stats.cls_all_failed = jevDown
  if (jevDown && (await previousRunJevDown())) {
    throw new Error(`jev failed ${part.failed}/${jevPool.length} calls on two consecutive runs — TypeSafe appears down`)
  }
}

// Did the last recorded run also lose most of its Jev calls? Read from
// pipeline_runs.stats so the guard has memory across runs. Unknown (no prior
// row, query error) reads as false: the guard errs toward not alerting on one
// run's evidence, which is the whole point of consulting it.
async function previousRunJevDown(): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('pipeline_runs')
    .select('stats')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return false
  return (data.stats as Record<string, unknown> | null)?.cls_all_failed === true
}

async function main() {
  if (!jevEnabled()) throw new Error('Missing required environment variable: TYPESAFE_API_KEY (relevance, signals, trending and story pairs all run on Jev)')
  const startedAt = new Date()
  const stats: RunStats = {}
  let runError: unknown = null
  try {
    await run(stats)
  } catch (err) {
    runError = err
    throw err
  } finally {
    // Exactly one run-log row per run — including the no-new-articles early
    // return and fatal paths (finally runs before the rethrow propagates).
    await recordRun(startedAt, stats, runError)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[pipeline] fatal:', err)
    process.exit(1)
  })
