import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from '$env/static/private'
import { isRelevant } from '$lib/relevance'

const BATCH_SIZE = 20

const SYSTEM_PROMPT = `You are the relevance filter for WW3Watch — a real-time feed tracking escalating global conflicts: wars, military strikes, assassinations, regime changes, nuclear threats, coups, and major geopolitical crises.

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

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0,
      max_tokens: BATCH_SIZE * 5,
    }),
    signal: AbortSignal.timeout(9000),
  })

  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)

  const data = await res.json()
  const text: string = data.choices?.[0]?.message?.content?.trim() ?? ''

  // Strip markdown code fences if the model wraps the JSON
  const clean = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
  const parsed: unknown = JSON.parse(clean)

  if (!Array.isArray(parsed) || parsed.length !== articles.length) {
    throw new Error(`Bad LLM response shape (got ${parsed}), expected ${articles.length} items`)
  }

  return (parsed as number[]).map(v => v === 1)
}

export async function classifyArticles(articles: ArticleInput[]): Promise<Set<string>> {
  const relevant = new Set<string>()

  // Non-English articles auto-pass — they come exclusively from specialist
  // regional sources (Iranian, Arabic) whose every article is conflict-relevant.
  const nonEnglish = articles.filter(a => a.source_lang !== 'en')
  nonEnglish.forEach(a => relevant.add(a.guid))

  const english = articles.filter(a => a.source_lang === 'en')
  if (english.length === 0) return relevant

  // Slice into batches and classify all in parallel
  const batches: ArticleInput[][] = []
  for (let i = 0; i < english.length; i += BATCH_SIZE) {
    batches.push(english.slice(i, i + BATCH_SIZE))
  }

  const results = await Promise.allSettled(batches.map(b => classifyBatch(b)))

  results.forEach((result, bi) => {
    const batch = batches[bi]
    if (result.status === 'fulfilled') {
      result.value.forEach((isRel, j) => {
        if (isRel) relevant.add(batch[j].guid)
      })
    } else {
      // LLM failed for this batch — fall back to keyword filter
      console.error('[classify] batch failed, using keyword fallback:', result.reason)
      batch.forEach(a => {
        if (isRelevant(a.title, a.summary ?? '', a.source_lang)) relevant.add(a.guid)
      })
    }
  })

  return relevant
}
