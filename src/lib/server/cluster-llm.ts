import { callLLM } from './llm'

// Response protocol: a JSON OBJECT mapping each article index to a compact label
// ("E<i>" join existing cluster i; "N<x>" shared new-story label). Why an object
// keyed by index rather than an ordered array:
//   - Raw UUID answers overflowed max_tokens and truncated (broke Mar–Jun).
//   - An ordered array requires the model to emit EXACTLY n items in order; LLMs
//     reliably MISCOUNT long lists, which failed the whole batch (observed at 100).
// Keyed-by-index parsing is tolerant: a miscount, a missing key, a bad value, or
// an out-of-range E just drops that one assignment (the article stays cluster_id
// null → retried next run / covered by client Jaccard) instead of failing all.
const SYSTEM_PROMPT = `You are the clustering engine for WW3Watch — a real-time news aggregator tracking global conflicts.

You will receive two sections:

EXISTING CLUSTERS: recent story clusters already in the system, each labeled E0, E1, E2, ...:
E<i>: "headline"

NEW ARTICLES: fresh articles to assign, numbered from 0:
<index>. "headline"

Rules:
- If a new article covers the same story as an EXISTING CLUSTER, use that cluster's label (e.g. "E4").
- If multiple new articles are the same story as each other (and no existing cluster matches), give them the same new label: "N0", "N1", etc.
- If a new article is a unique story, give it its own new label.
- If EXISTING CLUSTERS is (none), use only N labels.
- Articles may be in different languages — the same event in English, Persian, Arabic, Russian, etc. is the same cluster.

Return ONLY a JSON object mapping each article's number to its label. Include every article number.
Example (5 articles; #1 and #2 are the same new story; #3 joins existing cluster E2):
{"0":"N0","1":"N1","2":"N1","3":"E2","4":"N3"}
No explanation. No markdown.`

const LABEL_RE = /^[EN]\d+$/

export async function assignClusters(
  newArticles: Array<{ id: string; title: string }>,
  existingClusters: Array<{ id: string; title: string }>
): Promise<Map<string, string>> {
  // On total failure (bad JSON / not an object), return an empty map: articles
  // stay cluster_id=null and are re-selected by the next cron run.
  const fallback = (): Map<string, string> => new Map()

  if (newArticles.length === 0) return new Map()

  const existingSection = existingClusters.length > 0
    ? 'EXISTING CLUSTERS:\n' + existingClusters.map((c, i) => `E${i}: "${c.title}"`).join('\n')
    : 'EXISTING CLUSTERS:\n(none)'

  const newSection = 'NEW ARTICLES:\n' +
    newArticles.map((a, i) => `${i}. "${a.title}"`).join('\n')

  const userContent = `${existingSection}\n\n${newSection}`

  let parsed: unknown
  try {
    const clean = await callLLM(
      [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
      newArticles.length * 12 + 80,
    )
    parsed = JSON.parse(clean)
  } catch (err) {
    console.error('[cluster-llm] LLM call/parse failed, using empty-map fallback:', err)
    return fallback()
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.error('[cluster-llm] expected a JSON object, using empty-map fallback:', JSON.stringify(parsed)?.slice(0, 150))
    return fallback()
  }

  const labelByIndex = parsed as Record<string, unknown>
  const newLabelToRepId = new Map<string, string>()
  const result = new Map<string, string>()

  // Iterate in article order so a shared N label's representative is its
  // lowest-index article (deterministic regardless of object key order).
  for (let i = 0; i < newArticles.length; i++) {
    const label = labelByIndex[String(i)]
    if (typeof label !== 'string' || !LABEL_RE.test(label)) continue // skip missing/garbage

    if (label[0] === 'E') {
      const idx = Number(label.slice(1))
      if (idx >= existingClusters.length) continue // skip hallucinated/out-of-range
      result.set(newArticles[i].id, existingClusters[idx].id)
    } else {
      const repId = newLabelToRepId.get(label) ?? newArticles[i].id
      newLabelToRepId.set(label, repId)
      result.set(newArticles[i].id, repId)
    }
  }

  return result
}
