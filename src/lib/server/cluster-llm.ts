import { callLLM } from './llm'

// Response protocol: compact labels instead of raw UUIDs. UUID answers (~14
// tokens each) overflowed max_tokens at scale and truncated the JSON — cluster
// assignment silently failed on every run from March to June. Labels are ~4
// tokens, and the strict ^[EN]\d+$ validation also catches hallucinated values
// (previously an invented UUID was silently treated as a new-cluster label).
const SYSTEM_PROMPT = `You are the clustering engine for WW3Watch — a real-time news aggregator tracking global conflicts.

You will receive two sections:

EXISTING CLUSTERS: recent story clusters already in the system, each labeled E0, E1, E2, ...:
E<i>: "headline"

NEW ARTICLES: fresh articles that need to be assigned to clusters, numbered:
<index>. "headline"

Rules:
- If a new article covers the same story as an EXISTING CLUSTER, answer with that cluster's label (e.g. "E4").
- If multiple new articles cover the same story as each other (but no existing cluster matches), give them the same new label: "N0", "N1", etc.
- If a new article is a unique story with no matches anywhere, give it its own new label.
- If EXISTING CLUSTERS is (none), use only N labels.
- Articles may be in different languages — the same event reported in English, Persian, Arabic, Russian etc. belongs in the same cluster.

Return ONLY a JSON array of strings, one per new article (same order as input).
Each string must be an existing label like "E4" or a new label like "N0". No explanation. No markdown.
Example (5 articles; 2nd and 3rd are the same new story; 4th joins existing cluster E2):
["N0", "N1", "N1", "E2", "N2"]`

const LABEL_RE = /^[EN]\d+$/

export async function assignClusters(
  newArticles: Array<{ id: string; title: string }>,
  existingClusters: Array<{ id: string; title: string }>
): Promise<Map<string, string>> {
  // On any failure, return an empty map so articles stay cluster_id=null —
  // they're re-selected by the next cron run (15 min), and the frontend's
  // Jaccard fallback covers them meanwhile. No in-run retry needed.
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
      newArticles.length * 6 + 60,
    )
    parsed = JSON.parse(clean)
  } catch (err) {
    console.error('[cluster-llm] LLM call failed, using empty-map fallback:', err)
    return fallback()
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== newArticles.length ||
    !parsed.every((v): v is string => typeof v === 'string' && LABEL_RE.test(v))
  ) {
    console.error(
      '[cluster-llm] invalid response shape, using empty-map fallback:',
      JSON.stringify(parsed)?.slice(0, 200),
    )
    return fallback()
  }

  const labels = parsed as string[]

  // Every E-index must reference a real existing cluster.
  for (const label of labels) {
    if (label[0] === 'E' && Number(label.slice(1)) >= existingClusters.length) {
      console.error('[cluster-llm] E-label out of range, using empty-map fallback:', label)
      return fallback()
    }
  }

  // N labels: first article that received a label becomes the representative.
  const newLabelToRepId = new Map<string, string>()
  const result = new Map<string, string>()

  for (let i = 0; i < newArticles.length; i++) {
    const article = newArticles[i]
    const label = labels[i]

    if (label[0] === 'E') {
      result.set(article.id, existingClusters[Number(label.slice(1))].id)
    } else {
      const repId = newLabelToRepId.get(label) ?? article.id
      newLabelToRepId.set(label, repId)
      result.set(article.id, repId)
    }
  }

  return result
}
