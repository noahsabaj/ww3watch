import { callLLM } from './llm'
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

async function classifyBatch(articles: ArticleInput[]): Promise<boolean[]> {
  const userContent = articles
    .map((a, i) => `${i + 1}. "${a.title}" | ${(a.summary ?? '').slice(0, 200)}`)
    .join('\n')

  // callLLM handles rate-limiting, 429 retry/backoff, and fence stripping.
  const clean = await callLLM(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    BATCH_SIZE * 5,
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
}

export async function classifyArticles(articles: ArticleInput[]): Promise<ClassifyResult> {
  const relevant = new Set<string>()
  const rejected = new Set<string>()
  if (articles.length === 0) return { relevant, rejected }

  // Batch ALL articles (every language) through the LLM — it judges by meaning.
  // On a batch's LLM failure we fall back to the keyword filter, which leniently
  // keeps non-English (isRelevant returns true for lang !== 'en'), so transient
  // failures never drop foreign conflict coverage.
  const batches: ArticleInput[][] = []
  for (let i = 0; i < articles.length; i += BATCH_SIZE) {
    batches.push(articles.slice(i, i + BATCH_SIZE))
  }

  const results = await Promise.allSettled(batches.map(b => classifyBatch(b)))

  results.forEach((result, bi) => {
    const batch = batches[bi]
    if (result.status === 'fulfilled') {
      result.value.forEach((isRel, j) => {
        if (isRel) relevant.add(batch[j].guid)
        else rejected.add(batch[j].guid)
      })
    } else {
      console.error('[classify] batch failed, using keyword fallback:', result.reason)
      batch.forEach(a => {
        if (isRelevant(a.title, a.summary ?? '', a.source_lang)) relevant.add(a.guid)
      })
    }
  })

  return { relevant, rejected }
}
