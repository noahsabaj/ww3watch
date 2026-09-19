// Relevance: run the tiers (src/lib/server/judges.ts) in order. Each settles what
// it can; what it passes on is the next tier's; what the last tier passes on
// stays "new" for the next run.
import { selectStaleWriteOffs, staleRejectRow } from '../backlog'
import { headTier, jevTier, type Decision, type RelevanceTier } from '../judges'
import type { ArticleInsert } from '../rss'
import { CLASSIFY_BUDGET_MS, RUN_BUDGET_MS, STALE_WRITEOFF_HOURS } from '../config'
import { embedAndAssignClusters } from './clustering'
import { enrichSignals } from './signals'
import { writeRejects, upsertArticles, writeVerdicts, type VerdictRow } from './persist'
import { timed as timedStage, type RunStats } from './stats'

export interface ClassifyOutcome {
  /** Articles sent to Jev, and how many of those calls failed — the outage guard's input. */
  jevPool: number
  jevFailed: number
}

const newestFirst = <T extends { published_at?: string | null }>(items: T[]): T[] =>
  [...items].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))

/** Today's tiers, cheapest first. No generative model anywhere:
 *    head — a local logistic layer over the title embedding settles the obvious
 *           mass for free;
 *    jev  — TypeSafe's decision model gives everything else a calibrated
 *           P(relevant), and its verdict is final. */
export function defaultTiers(): Array<RelevanceTier<ArticleInsert>> {
  return [headTier<ArticleInsert>(), jevTier<ArticleInsert>()].filter((t): t is RelevanceTier<ArticleInsert> => t !== null)
}

export async function classifyFresh(
  fresh: ArticleInsert[],
  stats: RunStats,
  startedAt: number,
  tiers: Array<RelevanceTier<ArticleInsert>> = defaultTiers(),
): Promise<ClassifyOutcome> {
  const timed = <T>(stage: string, fn: () => Promise<T>) => timedStage(stats, stage, fn)
  // Classification gets a share of the run's budget, measured from the START of
  // the run so a slow fetch eats into it rather than pushing past the job's kill.
  const deadlineMs = startedAt + Math.min(CLASSIFY_BUDGET_MS, RUN_BUDGET_MS)

  // Every judgment made this run, with the probability behind it (→ verdicts).
  const verdicts: VerdictRow[] = []
  // What each tier decided, by guid — for the audit of the tiers before it.
  const decided = new Map<string, Decision>()
  const audits: Array<{ tier: string; audit: Map<ArticleInsert, Decision> }> = []
  const counts = { accept: 0, reject: 0 }
  const outcome: ClassifyOutcome = { jevPool: 0, jevFailed: 0 }
  let inserted = 0
  let remaining = newestFirst(fresh)

  for (const [i, tier] of tiers.entries()) {
    const isLast = i === tiers.length - 1
    const pool = remaining.slice(0, tier.cap)
    const overflow = remaining.slice(tier.cap)
    const res = await timed(tier.name, () => tier.judge(pool, { deadlineMs }))
    stats[`cls_${tier.name}`] = res.stats
    console.log(`[pipeline] ${tier.name}: ${res.summary}`)
    if (tier.name === 'jev') Object.assign(outcome, { jevPool: pool.length, jevFailed: res.failed })
    if (res.audit.size > 0) audits.push({ tier: tier.name, audit: res.audit })

    // Verdicts land as soon as the tier has them. A tier that is not the last is
    // followed by network calls, so its accepts are also clustered and annotated
    // NOW rather than after them — the local head's accepts used to reach the
    // feed minutes late for no reason.
    if (res.accept.length > 0) {
      const rows = res.accept.map((j) => ({ ...j.item, ...(tier.stamp?.(j) ?? {}) }))
      inserted += await timed(`${tier.name}_upsert`, () => upsertArticles(rows))
      if (!isLast) {
        await timed(`${tier.name}_cluster`, () => embedAndAssignClusters(stats))
        await timed(`${tier.name}_signals`, () => enrichSignals(stats, startedAt + RUN_BUDGET_MS))
      }
    }
    // Project explicit, homogeneous columns (never spread the article objects —
    // PostgREST 400s on unknown columns, and a batch needs uniform keys).
    // source_id + lang give the curation pass accept-rate per source/language;
    // reason keeps who said no on the record (the trainer never learns from 'head').
    if (res.reject.length > 0) {
      await writeRejects(
        res.reject.map(({ item: a }) => ({
          guid: a.guid, title: a.title, source_id: a.source_id ?? null, lang: a.source_lang ?? null, reason: tier.name,
        })),
      )
    }
    for (const decision of ['accept', 'reject'] as const) {
      for (const { item: a, p } of res[decision]) {
        decided.set(a.guid, decision)
        verdicts.push({
          guid: a.guid, judge: tier.name, decision, p, threshold: tier.threshold(decision),
          model: tier.model, lang: a.source_lang ?? null, source_id: a.source_id ?? null,
        })
      }
      counts[decision] += res[decision].length
    }
    remaining = newestFirst([...res.pass, ...overflow])
  }
  console.log(`[pipeline] inserted ${inserted} new articles`)
  stats.inserted = inserted

  // Anything still unjudged that is already too old to display is written off.
  // "Deferred to next run" was a lie for nine days once: the deferred remainder
  // grew to 6,007 — permanently re-fetched, re-deduped and never reconsidered. A
  // verdict on a two-day-old article cannot change what anyone sees; the feed
  // serves the newest 500. Keeps `new` meaning "actually new".
  const deferred = remaining
  const stale = selectStaleWriteOffs(deferred, Date.now() - STALE_WRITEOFF_HOURS * 3_600_000)
  if (stale.length > 0) {
    await timed('stale_writeoff', () => writeRejects(stale.map(staleRejectRow)))
    verdicts.push(...stale.map((a): VerdictRow => ({
      guid: a.guid, judge: 'stale', decision: 'reject', p: null, threshold: null, model: null,
      lang: a.source_lang ?? null, source_id: a.source_id ?? null,
    })))
    console.log(
      `[pipeline] wrote off ${stale.length} unjudged articles older than ${STALE_WRITEOFF_HOURS}h (too old to display)`,
    )
  }
  stats.stale_written_off = stale.length
  if (deferred.length > stale.length) {
    console.log(`[pipeline] ${deferred.length - stale.length} articles stay new for the next run`)
  }

  stats.verdicts_recorded = await timed('verdicts', () => writeVerdicts(verdicts))

  Object.assign(stats, {
    // Articles that actually got a verdict this run, from any tier.
    classified: counts.accept + counts.reject,
    deferred: deferred.length,
    relevant: counts.accept,
    rejected: counts.reject,
  })

  // A tier's audit slice rode along to the tiers after it; this is how often
  // they agreed with what it would have decided. Items nobody settled (failed
  // call, out of time) are excluded, not counted against.
  for (const { tier, audit } of audits) {
    const agreement = { accept: { n: 0, agree: 0 }, reject: { n: 0, agree: 0 } }
    for (const [a, wouldHave] of audit) {
      const actual = decided.get(a.guid)
      if (!actual) continue
      agreement[wouldHave].n++
      if (actual === wouldHave) agreement[wouldHave].agree++
    }
    const tierStats = stats[`cls_${tier}` as 'cls_head']
    if (tierStats) tierStats.audit_agreement = agreement
    console.log(
      `[pipeline] ${tier} audit: accept ${agreement.accept.agree}/${agreement.accept.n}, reject ${agreement.reject.agree}/${agreement.reject.n} agreed downstream`,
    )
  }

  return outcome
}
