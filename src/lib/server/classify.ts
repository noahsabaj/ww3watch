import { callLLM, LLMDeadlineError } from './llm'
import { isRelevant } from '../relevance'

const BATCH_SIZE = 30

const SYSTEM_PROMPT = `You are the relevance filter for WW3Watch — a real-time feed tracking escalating global conflicts: wars, military strikes, assassinations, regime changes, nuclear threats, coups, and major geopolitical crises.

Articles may be in any language (Persian, Arabic, Russian, etc.) — judge by meaning, not language.
For each numbered article, output 1 if it belongs on WW3Watch, or 0 if not.
Return ONLY a valid JSON array of integers (0 or 1), one per article, same order as input.
No explanation. No markdown. Just the array. Example: [1,0,1,1,0]`

interface ArticleInput {
  guid: string
  title: string
  summary: string | null
  source_lang: string
}

async function classifyBatch(articles: ArticleInput[], deadlineMs?: number): Promise<boolean[]> {
  const userContent = articles
    .map((a, i) => `${i + 1}. "${a.title}" | ${(a.summary ?? '').slice(0, 200)}`)
    .join('\n')

  // callLLM handles rate-limiting, 429 retry/backoff, and fence stripping.
  // Budget: ~5 tokens per verdict plus headroom for reasoning models (gpt-oss),
  // whose thinking spends from max_tokens before the answer — a cap sized to
  // the answer alone truncates it into unparseable JSON.
  const clean = await callLLM(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    1024 + BATCH_SIZE * 5,
    deadlineMs,
  )
  const parsed: unknown = JSON.parse(clean)

  // Strict: every element must be exactly 0 or 1. Strings ("1"), booleans, or
  // anything else mean the model went off-script — treat as batch failure rather
  // than verdicts. Critical now that rejections are recorded permanently: a
  // `["1","0",...]` response slipping through the old shape check would have
  // rejected an entire batch (including relevant articles) forever.
  if (
    !Array.isArray(parsed) ||
    parsed.length !== articles.length ||
    !parsed.every((v): v is 0 | 1 => v === 0 || v === 1)
  ) {
    throw new Error(`Bad LLM response shape, expected ${articles.length} 0/1 ints: ${JSON.stringify(parsed)?.slice(0, 120)}`)
  }

  return parsed.map(v => v === 1)
}

export interface ClassifyResult {
  relevant: Set<string>
  /** Rejections from SUCCESSFUL LLM batches only — these are recorded permanently
   *  (classified_rejects) so they're never re-classified. Keyword-fallback
   *  decisions are deliberately NOT included: those articles stay "new" and get
   *  a real LLM verdict on the next run. */
  rejected: Set<string>
  /** Batches attempted, and how many threw (fell back to keyword/defer). When
   *  failedBatches === attemptedBatches > 0 the LLM is effectively down — the
   *  pipeline fails the run loudly instead of laundering a near-empty result. */
  totalBatches: number
  failedBatches: number
  /** Batches never started because the run ran out of wall-clock budget. Their
   *  articles stay "new" and are picked up next run — the SAME deferral the
   *  per-run classify cap already relies on. Deliberately not counted as
   *  failures: running out of time is not the LLM being down, and conflating
   *  them would fail every busy run. */
  skippedBatches: number
}

/**
 * @param deadlineMs absolute epoch past which no further LLM call is started.
 *   Without it a run can spend longer in rate-limit backoff than the job is
 *   allowed to live, dying before it reaches a single insert — so nothing is
 *   written, nothing is recorded as rejected, and the identical backlog returns
 *   next run. With it, a run always finishes and always drains what it could.
 */
export async function classifyArticles(
  articles: ArticleInput[],
  deadlineMs?: number,
): Promise<ClassifyResult> {
  const relevant = new Set<string>()
  const rejected = new Set<string>()
  if (articles.length === 0) {
    return { relevant, rejected, totalBatches: 0, failedBatches: 0, skippedBatches: 0 }
  }

  // Batch ALL articles (every language) through the LLM — it judges by meaning.
  // On a batch's LLM failure: English falls back to the keyword filter;
  // non-English gets NO verdict (not relevant, not rejected) so it stays "new"
  // and receives a real LLM verdict on the next run (~15 min) — noise can't
  // leak in through a fallback that can't read the language.
  const batches: ArticleInput[][] = []
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    batches.push(articles.slice(i, i + BATCH_SIZE))
  }

  const results = await Promise.allSettled(batches.map(b => classifyBatch(b, deadlineMs)))

  let failedBatches = 0
  let skippedBatches = 0
  results.forEach((result, bi) => {
    const batch = batches[bi]
    if (result.status === 'fulfilled') {
      result.value.forEach((isRel, j) => {
        if (isRel) relevant.add(batch[j].guid)
        else rejected.add(batch[j].guid)
      })
    } else if (result.reason instanceof LLMDeadlineError) {
      // Out of budget, not broken. Give NO verdict so every article in the batch
      // stays "new" for the next run — the keyword fallback exists for a failed
      // LLM, and applying it here would let a slow run quietly lower the bar.
      skippedBatches++
    } else {
      failedBatches++
      console.error('[classify] batch failed, keyword fallback (en only):', result.reason)
      batch.forEach(a => {
        if (a.source_lang === 'en' && isRelevant(a.title, a.summary ?? '')) relevant.add(a.guid)
      })
    }
  })

  if (skippedBatches > 0) {
    console.warn(
      `[classify] ${skippedBatches}/${batches.length} batches deferred — out of run budget (${skippedBatches * BATCH_SIZE} articles stay new)`,
    )
  }

  return { relevant, rejected, totalBatches: batches.length, failedBatches, skippedBatches }
}
