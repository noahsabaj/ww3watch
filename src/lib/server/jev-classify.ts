import { askJev, type JevArticle } from './jev'

// Second routing tier, between the local head and the LLM. Jev returns a
// calibrated P(relevant) per article in ~150ms with no daily token cap, so it
// can judge the head's whole uncertain band every run; only what Jev itself is
// unsure about still spends LLM budget.
//
// Bands from scripts/eval-jev.ts (1,475 LLM-labelled titles, 7 languages,
// jev-1.13.0, titles only): ≤0.2 / ≥0.8 settles 74% with 4.1% false-accept and
// 3.5% false-reject AGAINST THE LLM'S LABELS — and the disagreements read as
// genuinely borderline stories, not errors. Tunable without a deploy.
export const JEV_REJECT_BELOW = Number(process.env.JEV_REJECT_BELOW || '') || 0.2
export const JEV_ACCEPT_ABOVE = Number(process.env.JEV_ACCEPT_ABOVE || '') || 0.8
const CONCURRENCY = Math.max(1, Number(process.env.JEV_CONCURRENCY || '') || 16)

// JEV_FINAL=1 retires the LLM as a classifier: Jev's own uncertain band is
// settled at 0.5 instead of being escalated. Only failed calls and the audit
// slice still reach the LLM, so agreement keeps being measured. OFF by default
// — flip it (a repo variable, no deploy) once stats.cls_jev.audit_agreement has
// held up over enough runs to trust.
export const jevFinal = (): boolean => process.env.JEV_FINAL === '1'

export const jevEnabled = (): boolean => Boolean(process.env.TYPESAFE_API_KEY)

export type JevTier = 'accept' | 'reject' | 'uncertain'

export function jevTier(p: number): JevTier {
  if (p >= JEV_ACCEPT_ABOVE) return 'accept'
  if (p <= JEV_REJECT_BELOW) return 'reject'
  return 'uncertain'
}

export interface JevPartition<T> {
  accept: T[]
  reject: T[]
  /** Jev's own uncertain band, its failures, and the audit slice: the LLM's. */
  uncertain: T[]
  /** Confident Jev verdicts sent to the LLM anyway, to keep measuring agreement. */
  audit: Map<T, JevTier>
  failed: number
  inputTokens: number
}

/**
 * Judge every article with Jev. A failed call is not a verdict: the article
 * falls through to the LLM, exactly as if Jev had been unsure.
 */
export async function partitionByJev<T extends JevArticle>(
  articles: T[],
  opts: { auditRate: number; deadlineMs?: number; random?: () => number; final?: boolean },
): Promise<JevPartition<T>> {
  const random = opts.random ?? Math.random
  const out: JevPartition<T> = { accept: [], reject: [], uncertain: [], audit: new Map(), failed: 0, inputTokens: 0 }
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, articles.length) }, async () => {
      while (next < articles.length) {
        const article = articles[next++]
        if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
          out.uncertain.push(article)
          continue
        }
        try {
          const v = await askJev(article, undefined, opts.deadlineMs)
          out.inputTokens += v.inputTokens
          const tier = jevTier(v.relevant)
          if (tier === 'uncertain') {
            if (opts.final) out[v.relevant >= 0.5 ? 'accept' : 'reject'].push(article)
            else out.uncertain.push(article)
          }
          else if (random() < opts.auditRate) {
            out.audit.set(article, tier)
            out.uncertain.push(article)
          } else out[tier].push(article)
        } catch (err) {
          out.failed++
          if (out.failed <= 3) console.error('[jev] call failed, article falls through to the LLM:', String(err).slice(0, 200))
          out.uncertain.push(article)
        }
      }
    }),
  )
  return out
}
