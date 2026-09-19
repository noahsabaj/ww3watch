// Relevance judges, behind one interface.
//
// This repo has had three judgment systems — an LLM, then a local head in front
// of it, then Jev replacing it — and each one was threaded through the pipeline
// by hand. A tier is now a value: it takes articles and returns the ones it
// accepts, the ones it rejects, and the ones it has no opinion on (the next
// tier's). The pipeline runs a LIST of tiers (pipeline/classify.ts); adding,
// removing or reordering one is an edit to that list.
import { loadHead, headScore, partitionByHead } from './prefilter'
import { embedTitles, shouldEmbed } from './embeddings'
import { partitionByJev } from './jev-classify'
import { JEV_MODEL, type JevArticle } from './jev'
import { HEAD_AUDIT_RATE, HEAD_POOL_CAP, JEV_POOL_CAP, JEV_THRESHOLD } from './config'

export type Decision = 'accept' | 'reject'

export interface Judged<T> {
  item: T
  /** The judge's probability/score for "relevant"; recorded in `verdicts`. */
  p: number | null
}

export interface TierResult<T> {
  accept: Judged<T>[]
  reject: Judged<T>[]
  /** No verdict from this tier: uncertain, un-judgeable, failed, or out of time. */
  pass: T[]
  /** Confident verdicts this tier handed on ANYWAY, so the tiers after it keep
   *  measuring how often they agree with it. They are in `pass`, not in
   *  accept/reject — the later verdict is the one that lands. */
  audit: Map<T, Decision>
  /** Calls that failed (a network judge). Feeds the outage guard. */
  failed: number
  /** Tier-specific numbers for pipeline_runs.stats[`cls_${name}`]. */
  stats: Record<string, unknown>
  /** One line for the run log. */
  summary: string
}

export interface RelevanceTier<T> {
  /** Also `classified_rejects.reason` and `verdicts.judge`. */
  name: 'head' | 'jev'
  /** Recorded with every verdict, so scores stay comparable within a vintage. */
  model: string
  /** The cut a decision was made against. */
  threshold: (d: Decision) => number
  /** Most articles this tier looks at per run; the rest pass through untouched. */
  cap: number
  judge: (items: T[], ctx: { deadlineMs: number }) => Promise<TierResult<T>>
  /** Columns to stamp on an accepted row before it is inserted. */
  stamp?: (j: Judged<T>) => Partial<Record<'jev_relevant', number>>
}

type Article = JevArticle & { guid: string }

/** The local relevance head, or null when its weights are absent/incompatible. */
export function headTier<T extends Article>(): RelevanceTier<T> | null {
  const head = loadHead()
  if (!head) return null
  return {
    name: 'head',
    model: head.trained_at,
    threshold: (d) => (d === 'accept' ? head.accept_above : head.reject_below),
    cap: HEAD_POOL_CAP,
    async judge(items) {
      const embeddable = items.filter((a) => shouldEmbed(a.title))
      const vecs = await embedTitles(embeddable.map((a) => a.title))
      const part = partitionByHead(embeddable, vecs.map((v) => headScore(head, v)), head, { auditRate: HEAD_AUDIT_RATE })
      const judged = (a: T): Judged<T> => ({ item: a, p: part.scores.get(a) ?? null })
      const audit = new Map<T, Decision>()
      for (const [a, tier] of part.audit) if (tier !== 'uncertain') audit.set(a, tier)
      return {
        accept: part.accept.map(judged),
        reject: part.reject.map(judged),
        // Titles too short to embed get no head opinion — they go straight on.
        pass: [...part.uncertain, ...items.filter((a) => !shouldEmbed(a.title))],
        audit,
        failed: 0,
        stats: {
          trained_at: head.trained_at,
          pool: items.length,
          accept: part.accept.length,
          reject: part.reject.length,
          uncertain: part.uncertain.length,
          audit: part.audit.size,
        },
        summary: `${items.length} scored → accept ${part.accept.length}, reject ${part.reject.length}, uncertain ${part.uncertain.length} (+${part.audit.size} audit)`,
      }
    },
  }
}

/** TypeSafe's Jev: a calibrated P(relevant), final at JEV_THRESHOLD. */
export function jevTier<T extends Article>(): RelevanceTier<T> {
  return {
    name: 'jev',
    model: JEV_MODEL,
    threshold: () => JEV_THRESHOLD,
    cap: JEV_POOL_CAP,
    stamp: (j) => (j.p === null ? {} : { jev_relevant: j.p }),
    async judge(items, ctx) {
      const part = await partitionByJev(items, { deadlineMs: ctx.deadlineMs })
      const strip = (a: T & { jev_relevant: number }): Judged<T> => {
        const { jev_relevant, ...item } = a
        return { item: item as unknown as T, p: jev_relevant }
      }
      return {
        accept: part.accept.map(strip),
        reject: part.reject.map(strip),
        pass: part.unjudged,
        audit: new Map(),
        failed: part.failed,
        stats: {
          pool: items.length,
          accept: part.accept.length,
          reject: part.reject.length,
          // Verdicts that landed near the cut — the number to watch if the feed
          // ever looks too loose or too tight. They are still verdicts.
          borderline: part.borderline,
          unjudged: part.unjudged.length,
          failed: part.failed,
          input_tokens: part.inputTokens,
          threshold: JEV_THRESHOLD,
        },
        summary: `${items.length} sent → accept ${part.accept.length}, reject ${part.reject.length} (${part.borderline} borderline), ${part.unjudged.length} unjudged (${part.failed} failed)`,
      }
    },
  }
}
