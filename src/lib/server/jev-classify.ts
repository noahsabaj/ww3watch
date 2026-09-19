import { askJev, type JevArticle } from './jev'

// The relevance judge. Jev returns a calibrated P(relevant) per article in
// ~150ms with no daily token cap, and its verdict is FINAL — there is no
// generative model behind it to escalate to. (There was: an LLM tier capped at
// ~2,000 verdicts/day by its provider's token quota, which is what Jev replaced.)
//
// docs/evals/2026-09-19-jev-relevance.md — 1,475 LLM-labelled titles in 7 languages, titles only:
// AUC 0.956, 87.9% agreement at this cut — and the disagreements read as
// genuinely borderline stories, not misses. In production Jev also sees the
// summary. Tunable without a deploy: raise it for a tighter feed.
export const JEV_THRESHOLD = Number(process.env.JEV_THRESHOLD || '') || 0.5
const CONCURRENCY = Math.max(1, Number(process.env.JEV_CONCURRENCY || '') || 16)

export const jevEnabled = (): boolean => Boolean(process.env.TYPESAFE_API_KEY)

/** A verdict this close to the cut is still a verdict; it is counted so a feed
 *  that drifts loose or tight shows up in stats.cls_jev.borderline first. */
const BORDERLINE = 0.3

export interface JevPartition<T> {
  /** Accepted, each stamped with Jev's P(relevant) so the signals stage does
   *  not have to ask the same question again. */
  accept: Array<T & { jev_relevant: number }>
  reject: T[]
  /** No verdict: the call failed or the run was out of time. The article stays
   *  "new" and is judged next run — never guessed at. */
  unjudged: T[]
  borderline: number
  failed: number
  inputTokens: number
}

export async function partitionByJev<T extends JevArticle>(
  articles: T[],
  opts: { deadlineMs?: number } = {},
): Promise<JevPartition<T>> {
  const out: JevPartition<T> = { accept: [], reject: [], unjudged: [], borderline: 0, failed: 0, inputTokens: 0 }
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, articles.length) }, async () => {
      while (next < articles.length) {
        const article = articles[next++]
        if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) {
          out.unjudged.push(article)
          continue
        }
        try {
          const v = await askJev(article, undefined, opts.deadlineMs)
          out.inputTokens += v.inputTokens
          if (Math.abs(v.relevant - JEV_THRESHOLD) < BORDERLINE) out.borderline++
          if (v.relevant >= JEV_THRESHOLD) out.accept.push({ ...article, jev_relevant: v.relevant })
          else out.reject.push(article)
        } catch (err) {
          out.failed++
          if (out.failed <= 3) console.error('[jev] call failed, article stays new for the next run:', String(err).slice(0, 200))
          out.unjudged.push(article)
        }
      }
    }),
  )
  return out
}
