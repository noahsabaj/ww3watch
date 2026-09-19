// Every tunable number in the pipeline, in one place.
//
// They used to be 27 `process.env` reads across six files, and one threshold
// lived in three runtimes. Two rules now: a knob is declared HERE, and every run
// records the values it used (configSnapshot → pipeline_runs.stats.config), so
// "which thresholds produced this run?" has an answer.
//
// `||` not `??` throughout: workflows pass unset vars as EMPTY strings, and
// Number('') === 0 would silently turn a threshold off.
import { EMBED_SIM_THRESHOLD } from './embeddings'
import { JEV_MODEL } from './jev'

const num = (name: string, fallback: number): number => Number(process.env[name] || '') || fallback

export const UPSERT_BATCH = 200
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
export const RUN_BUDGET_MS = num('RUN_BUDGET_MS', 15 * 60_000)
export const CLASSIFY_BUDGET_MS = num('CLASSIFY_BUDGET_MS', 9 * 60_000)
// The local relevance head (src/lib/server/prefilter.ts) scores up to this
// many new articles per run — embedding is local and cheap (~25/s on the
// runner), so the pool is sized for draining a backlog, not for a quiet run.
// Only the uncertain band goes on to Jev.
export const HEAD_POOL_CAP = num('HEAD_POOL_CAP', 2000)
// Accepted articles Jev annotates per run (topic, severity, claim status, actors
// — src/lib/signals.ts). A worklist, so a backlog or an outage drains over the
// following runs instead of being lost.
export const SIGNALS_CAP = num('SIGNALS_CAP', 600)
export const SIGNALS_LOOKBACK_HOURS = 48
export const SIGNALS_CONCURRENCY = 16
// The signals request also returns Jev's P(relevant) for the article. The local
// head's accepts never passed Jev's relevance gate, so this is their second
// opinion, for free: below this, the article is removed again (its guid goes to
// classified_rejects). Deliberately far below the 0.5 accept cut — two judges
// disagreeing mildly is not grounds to delete — and capped per run, so a bad
// question edit cannot empty the feed before someone notices.
export const PURGE_BELOW = num('PURGE_BELOW', 0.2)
export const PURGE_CAP_PER_RUN = 25
// Grey-band judging + assignment happen in chronological chunks this size, so an
// article can be JUDGED against a story created moments earlier in the same run
// (within one chunk, items still meet by threshold alone).
export const PAIR_CHUNK = 20
// Feeds that fetch fine but almost never yield an accepted article.
export const LOW_YIELD = { days: 7, minItems: 100, maxPct: 2 }
// Jev (TypeSafe) judges up to this many of the still-unsettled articles per run.
// No daily cap and ~150ms a call, so the bound is wall-clock, not quota.
export const JEV_POOL_CAP = num('JEV_POOL_CAP', 2000)
// Share of confident head verdicts that Jev judges anyway, so the head's live
// agreement is measured every run (stats.cls_head.audit_agreement) instead of
// trusted from its training holdout.
export const HEAD_AUDIT_RATE = num('HEAD_AUDIT_RATE', 0.03)
// Consecutive failed fetches after which a source is switched off. With a run
// every ~15 min this is roughly two days of solid failure — a moved feed URL or
// a WAF that now blocks the runner and the proxy alike, not a bad afternoon.
// Disabled sources are listed in stats.sources_disabled and the workflow files
// a feed-health issue so a person re-curates (curation is SQL, not commits).
export const AUTO_DISABLE_AFTER = num('AUTO_DISABLE_AFTER', 200)
// Past the cap, an article this old is written off unjudged rather than deferred
// forever. Sized against what the product can actually show: the feed serves the
// newest 500 articles, which even at a healthy accept rate is well under a day
// of content — so a verdict on a 48h-old item cannot change what anyone sees.
// Env-overridable to make draining an accumulated backlog a one-run operation.
export const STALE_WRITEOFF_HOURS = num('STALE_WRITEOFF_HOURS', 48)
// Clustering worklist: everything unassigned from the last day, capped. Covers
// this run's inserts AND articles from runs whose embed/assign step failed
// (self-heal — driven purely by story_id IS NULL, nothing is ever orphaned).
export const ASSIGN_LOOKBACK_HOURS = 24
export const ASSIGN_CAP = 300
export const ASSIGN_RPC_CHUNK = 100
export const ID_QUERY_CHUNK = 100 // .in() filters travel in the URL — keep chunks small

// ── Jev: relevance ──────────────────────────────────────────────────────────
// docs/evals/2026-09-19-jev-relevance.md — 1,475 LLM-labelled titles in 7
// languages, titles only: AUC 0.956, 87.9% agreement at this cut, and the
// disagreements read as genuinely borderline stories. In production Jev also
// sees the summary. Raise it for a tighter feed.
export const JEV_THRESHOLD = num('JEV_THRESHOLD', 0.5)
export const JEV_CONCURRENCY = Math.max(1, num('JEV_CONCURRENCY', 16))

// ── Jev: story pairs ────────────────────────────────────────────────────────
// Nearest-story similarity band that gets a judgment. Below `lo` the embedding
// is trusted to say "different", at or above `hi` to say "same" (every sampled
// prod join above 0.88 was right; most between the 0.83 threshold and 0.88 were
// not).
export const PAIR_BAND = { lo: num('JEV_PAIR_LO', 0.78), hi: num('JEV_PAIR_HI', 0.9) }
// Story MERGE pass: representatives of stories active in the last `hours` whose
// similarity is at least `minSim` are judged; at most `maxPerRun` merges, so a
// bad question edit cannot fold the feed into one story before anyone notices.
export const STORY_MERGE = { hours: 24, minSim: num('STORY_MERGE_MIN_SIM', 0.8), candidates: 60, maxPerRun: 15 }
export const PAIR_YES = num('JEV_PAIR_YES', 0.7)
export const PAIR_NO = num('JEV_PAIR_NO', 0.3)

/** What this run ran with. Recorded once per run; never contains a secret. */
export function configSnapshot(): Record<string, unknown> {
  return {
    JEV_MODEL,
    JEV_THRESHOLD, JEV_POOL_CAP, JEV_CONCURRENCY,
    PAIR_BAND, PAIR_YES, PAIR_NO, PAIR_CHUNK, STORY_MERGE,
    HEAD_POOL_CAP, HEAD_AUDIT_RATE,
    PURGE_BELOW, PURGE_CAP_PER_RUN,
    SIGNALS_CAP, SIGNALS_LOOKBACK_HOURS,
    ASSIGN_CAP, ASSIGN_LOOKBACK_HOURS,
    EMBED_SIM_THRESHOLD,
    STALE_WRITEOFF_HOURS, AUTO_DISABLE_AFTER,
    RUN_BUDGET_MS, CLASSIFY_BUDGET_MS,
    LOW_YIELD,
  }
}
