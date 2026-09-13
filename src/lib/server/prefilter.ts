// Local relevance head: a logistic-regression layer over the same e5 title
// embeddings the clusterer computes, trained on the LLM's own verdicts
// (scripts/train-classifier.ts, weights committed at HEAD_PATH).
//
// Three tiers. Confident accepts and rejects never reach the LLM; the uncertain
// band between the two thresholds does. A small random slice of the confident
// tiers is still sent to the LLM as an audit so the head's live agreement is
// measured every run (pipeline_runs.stats.cls_head) rather than assumed from
// the training holdout.
//
// The head only ROUTES — it decides whether an article is judged locally or by
// the LLM, and for the confident tiers what that judgment is. It never touches
// what a journalist wrote (docs/CONVENTIONS.md).
import { readFileSync } from 'node:fs'
import { EMBEDDING_DIM, EMBEDDING_MODEL_TAG } from './embeddings'

export const HEAD_PATH = 'data/classifier-me5b.json'

export interface ClassifierHead {
  model_tag: string
  trained_at: string
  n_pos: number
  n_neg: number
  weights: number[]
  bias: number
  /** score < reject_below → confident reject (skips the LLM). */
  reject_below: number
  /** score > accept_above → confident accept (skips the LLM). */
  accept_above: number
  holdout?: Record<string, unknown>
}

export type Tier = 'accept' | 'reject' | 'uncertain'

// Weights are only meaningful for the exact embedding vintage they were trained
// on. A model_tag mismatch (re-quantized model, new revision) disables the head
// rather than silently scoring foreign vectors: the pipeline falls back to
// LLM-only, which is what it did before the head existed.
export function loadHead(path = HEAD_PATH): ClassifierHead | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    console.log(`[prefilter] no head at ${path} — LLM-only classification`)
    return null
  }
  let head: ClassifierHead
  try {
    head = JSON.parse(raw)
  } catch (err) {
    console.error(`[prefilter] head at ${path} is not valid JSON — LLM-only classification:`, err)
    return null
  }
  const problems = validateHead(head)
  if (problems.length > 0) {
    console.error(`[prefilter] head at ${path} rejected (${problems.join('; ')}) — LLM-only classification`)
    return null
  }
  return head
}

export function validateHead(head: ClassifierHead): string[] {
  const problems: string[] = []
  if (head.model_tag !== EMBEDDING_MODEL_TAG) {
    problems.push(`model_tag ${head.model_tag} != ${EMBEDDING_MODEL_TAG}`)
  }
  if (!Array.isArray(head.weights) || head.weights.length !== EMBEDDING_DIM) {
    problems.push(`weights length ${head.weights?.length ?? 0} != ${EMBEDDING_DIM}`)
  }
  if (!Number.isFinite(head.bias)) problems.push('bias is not a number')
  if (!(head.reject_below >= 0 && head.reject_below <= 1)) problems.push('reject_below out of [0,1]')
  if (!(head.accept_above >= 0 && head.accept_above <= 1)) problems.push('accept_above out of [0,1]')
  if (head.reject_below >= head.accept_above) problems.push('reject_below >= accept_above (no uncertain band)')
  return problems
}

export function headScore(head: ClassifierHead, vec: number[]): number {
  let z = head.bias
  const w = head.weights
  for (let i = 0; i < w.length; i++) z += w[i] * vec[i]
  return 1 / (1 + Math.exp(-z))
}

export function tierOf(head: ClassifierHead, score: number): Tier {
  if (score < head.reject_below) return 'reject'
  if (score > head.accept_above) return 'accept'
  return 'uncertain'
}

export interface Partition<T> {
  accept: T[]
  reject: T[]
  /** Everything the LLM must judge: the uncertain band plus the audit sample. */
  uncertain: T[]
  /** Audit items (a random slice of the confident tiers) and the tier the head
   *  gave them; they ride along in `uncertain` and get a real LLM verdict. */
  audit: Map<T, Tier>
  scores: Map<T, number>
}

// Route items by head score. `random` is injectable so tests are deterministic.
export function partitionByHead<T>(
  items: T[],
  scores: number[],
  head: ClassifierHead,
  opts: { auditRate: number; random?: () => number },
): Partition<T> {
  const random = opts.random ?? Math.random
  const out: Partition<T> = { accept: [], reject: [], uncertain: [], audit: new Map(), scores: new Map() }
  items.forEach((item, i) => {
    const score = scores[i]
    out.scores.set(item, score)
    const tier = tierOf(head, score)
    if (tier === 'uncertain') {
      out.uncertain.push(item)
    } else if (random() < opts.auditRate) {
      out.audit.set(item, tier)
      out.uncertain.push(item)
    } else if (tier === 'accept') {
      out.accept.push(item)
    } else {
      out.reject.push(item)
    }
  })
  return out
}

export interface AuditStats {
  accept: { n: number; agree: number }
  reject: { n: number; agree: number }
}

// How often the LLM agreed with the head on the audit slice. Items the LLM
// gave no verdict (failed/deferred batch) are excluded, not counted against.
export function auditAgreement<T>(
  audit: Map<T, Tier>,
  keyOf: (item: T) => string,
  relevant: Set<string>,
  rejected: Set<string>,
): AuditStats {
  const stats: AuditStats = { accept: { n: 0, agree: 0 }, reject: { n: 0, agree: 0 } }
  for (const [item, tier] of audit) {
    const k = keyOf(item)
    const verdict = relevant.has(k) ? 'accept' : rejected.has(k) ? 'reject' : null
    if (!verdict || tier === 'uncertain') continue
    const bucket = stats[tier]
    bucket.n++
    if (verdict === tier) bucket.agree++
  }
  return stats
}
