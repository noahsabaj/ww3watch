import { callLLM } from '$lib/server/llm'

const SYSTEM_PROMPT = `You are the clustering engine for WW3Watch — a real-time news aggregator tracking global conflicts.

You will receive two sections:

EXISTING CLUSTERS: recent story clusters already in the system. Each line is:
<uuid>: "headline"

NEW ARTICLES: fresh articles that need to be assigned to clusters. Each line is:
<index>. "headline"

Rules:
- If a new article covers the same story as an EXISTING CLUSTER, assign it that cluster's UUID
- If multiple new articles cover the same story as each other (but no existing cluster matches), assign them the same label: "NEW_0", "NEW_1", etc.
- If a new article is a unique story with no matches anywhere, give it its own unique new label

Return ONLY a JSON array of N strings, one per new article (in the same order as input).
Values are either an existing cluster UUID or a label like "NEW_0", "NEW_1", etc.
No explanation. No markdown. No other text.
Example (5 articles, 2nd and 3rd are same new story, 4th joins existing cluster):
["NEW_0", "NEW_1", "NEW_1", "abc-def-123", "NEW_2"]`

export async function assignClusters(
  newArticles: Array<{ id: string; title: string }>,
  existingClusters: Array<{ id: string; title: string }>
): Promise<Map<string, string>> {
  // On LLM failure, return empty map so articles stay cluster_id=null
  // and fall through to Jaccard clustering on the frontend.
  // (Assigning cluster_id=id as singletons would bypass Jaccard entirely.)
  const fallback = (): Map<string, string> => new Map()

  if (newArticles.length === 0) return new Map()

  const existingSection = existingClusters.length > 0
    ? 'EXISTING CLUSTERS:\n' + existingClusters.map(c => `${c.id}: "${c.title}"`).join('\n')
    : 'EXISTING CLUSTERS:\n(none)'

  const newSection = 'NEW ARTICLES:\n' +
    newArticles.map((a, i) => `${i}. "${a.title}"`).join('\n')

  const userContent = `${existingSection}\n\n${newSection}`

  let parsed: unknown
  try {
    const clean = await callLLM(
      [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
      newArticles.length * 15 + 20,
    )
    parsed = JSON.parse(clean)
  } catch (err) {
    console.error('[cluster-llm] LLM call failed, using singleton fallback:', err)
    return fallback()
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== newArticles.length ||
    !parsed.every((v): v is string => typeof v === 'string')
  ) {
    console.error('[cluster-llm] Unexpected LLM response shape, using singleton fallback:', parsed)
    return fallback()
  }

  const labels = parsed as string[]
  const existingIds = new Set(existingClusters.map(c => c.id))

  // Map NEW_X labels to the first article that received them
  const newLabelToRepId = new Map<string, string>()
  const result = new Map<string, string>()

  for (let i = 0; i < newArticles.length; i++) {
    const article = newArticles[i]
    const label = labels[i]

    if (existingIds.has(label)) {
      // Joins an existing cluster
      result.set(article.id, label)
    } else {
      // NEW_X label — first occurrence becomes the representative
      const repId = newLabelToRepId.get(label) ?? article.id
      newLabelToRepId.set(label, repId)
      result.set(article.id, repId)
    }
  }

  return result
}
