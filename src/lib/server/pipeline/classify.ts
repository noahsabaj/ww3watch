// Relevance: the local head first, then Jev for everything it leaves uncertain.
import { selectStaleWriteOffs, staleRejectRow } from '../backlog'
import { loadHead, headScore, partitionByHead, auditAgreement } from '../prefilter'
import { embedTitles, shouldEmbed } from '../embeddings'
import { partitionByJev } from '../jev-classify'
import type { ArticleInsert } from '../rss'
import { CLASSIFY_BUDGET_MS, HEAD_AUDIT_RATE, HEAD_POOL_CAP, JEV_POOL_CAP, JEV_THRESHOLD, RUN_BUDGET_MS, STALE_WRITEOFF_HOURS } from '../config'
import { embedAndAssignClusters } from './clustering'
import { enrichSignals } from './signals'
import { writeRejects, upsertArticles, writeVerdicts, type VerdictRow } from './persist'
import { JEV_MODEL } from '../jev'
import { timed as timedStage, type RunStats } from './stats'

export interface ClassifyOutcome {
  /** Articles sent to Jev, and how many of those calls failed — the outage guard's input. */
  jevPool: number
  jevFailed: number
}

export async function classifyFresh(fresh: ArticleInsert[], stats: RunStats, startedAt: number): Promise<ClassifyOutcome> {
  const timed = <T>(stage: string, fn: () => Promise<T>) => timedStage(stats, stage, fn)
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
  // Every judgment made this run, with the probability behind it (→ verdicts).
  const verdicts: VerdictRow[] = []
  if (head) {
    const pool = ordered.slice(0, HEAD_POOL_CAP)
    const embeddable = pool.filter((a) => shouldEmbed(a.title))
    const vecs = await timed('head', () => embedTitles(embeddable.map((a) => a.title)))
    const part = partitionByHead(embeddable, vecs.map((v) => headScore(head, v)), head, { auditRate: HEAD_AUDIT_RATE })
    headAccept = part.accept
    headReject = part.reject
    audit = part.audit
    const headVerdict = (decision: 'accept' | 'reject') => (a: (typeof ordered)[number]): VerdictRow => ({
      guid: a.guid, judge: 'head', decision, p: part.scores.get(a) ?? null,
      threshold: decision === 'accept' ? head.accept_above : head.reject_below,
      model: head.trained_at, lang: a.source_lang ?? null, source_id: a.source_id ?? null,
    })
    verdicts.push(...headAccept.map(headVerdict('accept')), ...headReject.map(headVerdict('reject')))
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
  for (const [decision, list] of [['accept', part.accept], ['reject', part.reject]] as const) {
    verdicts.push(...list.map((a): VerdictRow => ({
      guid: a.guid, judge: 'jev', decision, p: a.jev_relevant, threshold: JEV_THRESHOLD,
      model: JEV_MODEL, lang: a.source_lang ?? null, source_id: a.source_id ?? null,
    })))
  }
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

  return { jevPool: jevPool.length, jevFailed: part.failed }
}
