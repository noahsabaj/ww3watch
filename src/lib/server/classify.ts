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

  if (!Array.isArray(parsed) || parsed.length !== articles.length) {
    throw new Error(`Bad LLM response shape (got ${parsed}), expected ${articles.length} items`)
  }

  return (parsed as number[]).map(v => v === 1)
}

export async function classifyArticles(articles: ArticleInput[]): Promise<Set<string>> {
  const relevant = new Set<string>()
  if (articles.length === 0) return relevant

  // Batch ALL articles (every language) through the LLM — Cerebras is multilingual
  // and judges by meaning. Previously non-English auto-passed, which flooded the
  // feed with general non-English news (Iranian regional/economics/city dailies,
  // Russian general, NRK/SVT). On a batch's LLM failure we fall back to the keyword
  // filter, which still leniently keeps non-English (isRelevant returns true for
  // lang !== 'en'), so transient failures never drop foreign conflict coverage.
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
      })
    } else {
      console.error('[classify] batch failed, using keyword fallback:', result.reason)
      batch.forEach(a => {
        if (isRelevant(a.title, a.summary ?? '', a.source_lang)) relevant.add(a.guid)
      })
    }
  })

  return relevant
}
