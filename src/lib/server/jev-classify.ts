import { askJev, type JevArticle } from './jev'
import { mapPool } from './pool'
import { JEV_CONCURRENCY, JEV_THRESHOLD } from './config'

// The relevance judge. Jev returns a calibrated P(relevant) per article in
// ~150ms with no daily token cap, and its verdict is FINAL — there is no
// generative model behind it to escalate to. (There was: an LLM tier capped at
// ~2,000 verdicts/day by its provider's token quota, which is what Jev replaced.)
// The threshold and its evidence live in ./config.
export { JEV_THRESHOLD }

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
  const pool = await mapPool(articles, JEV_CONCURRENCY, (a) => askJev(a, undefined, opts.deadlineMs), opts)
  for (const { item, value } of pool.done) {
    out.inputTokens += value.inputTokens
    if (Math.abs(value.relevant - JEV_THRESHOLD) < BORDERLINE) out.borderline++
    if (value.relevant >= JEV_THRESHOLD) out.accept.push({ ...item, jev_relevant: value.relevant })
    else out.reject.push(item)
  }
  pool.failed.slice(0, 3).forEach(({ error }) =>
    console.error('[jev] call failed, article stays new for the next run:', String(error).slice(0, 200)),
  )
  out.failed = pool.failed.length
  out.unjudged = [...pool.failed.map((f) => f.item), ...pool.skipped]
  return out
}
