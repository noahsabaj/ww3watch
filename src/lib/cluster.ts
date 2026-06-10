import type { Article } from './types'

export interface Cluster {
  id: string
  representative: Article
  articles: Article[]
  sourceCount: number
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'of',
  'for', 'with', 'by', 'has', 'had', 'have', 'be', 'been', 'as', 'its', 'it',
  'this', 'that', 'these', 'those', 'says', 'said', 'say', 'after', 'amid',
  'into', 'from', 'over', 'under', 'about', 'and', 'but', 'or', 'not', 'new',
  'his', 'her', 'their', 'our', 'who', 'what', 'how', 'when', 'where', 'why',
])

// True-Jaccard threshold. Genuine same-story headlines score ~0.5-0.85; the
// over-merge false positives (a short headline whose tokens are a subset of a
// longer unrelated one) score ~0.2 and are now rejected.
const CLUSTER_THRESHOLD = 0.35
const CLUSTER_WINDOW_MS = 8 * 60 * 60 * 1000

function tokenize(title: string): Set<string> {
  return new Set(
    title.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w))
  )
}

function similarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const word of setA) {
    if (setB.has(word)) intersection++
  }
  // True Jaccard: intersection / union. (Was intersection / min(sizes) — the
  // overlap coefficient — which scored a short title fully contained in a longer
  // unrelated one as 1.0 and over-merged.)
  return intersection / (setA.size + setB.size - intersection)
}

export function groupByClusterId(articles: Article[]): Cluster[] {
  // Articles with LLM-assigned cluster_id: group by that ID (O(n))
  const assigned = articles.filter(a => a.cluster_id !== null)
  const unassigned = articles.filter(a => a.cluster_id === null)

  const map = new Map<string, Article[]>()
  for (const a of assigned) {
    const key = a.cluster_id!
    const group = map.get(key) ?? []
    group.push(a)
    map.set(key, group)
  }
  const dbClusters: Cluster[] = [...map.values()].map(group => ({
    id: group[0].cluster_id!,
    representative: group[0],
    articles: group,
    sourceCount: new Set(group.map(a => a.source_name)).size,
  }))

  // Articles without cluster_id: fall back to Jaccard (covers existing DB articles)
  const jaccardClusters = clusterArticles(unassigned)

  // Merge and sort by representative published_at DESC so Jaccard clusters
  // (articles not yet LLM-processed) don't get buried below all DB clusters.
  return [...dbClusters, ...jaccardClusters].sort((a, b) => {
    const aTime = a.representative.published_at ? new Date(a.representative.published_at).getTime() : 0
    const bTime = b.representative.published_at ? new Date(b.representative.published_at).getTime() : 0
    return bTime - aTime
  })
}

export function clusterArticles(articles: Article[]): Cluster[] {
  const clusters: Cluster[] = []

  // Tokenize each title once per invocation — similarity() runs O(n^2) pairwise
  // and re-tokenizing the same representative hundreds of times dominated cost.
  const tokens = new Map<string, Set<string>>()
  const tokensFor = (title: string): Set<string> => {
    let set = tokens.get(title)
    if (!set) {
      set = tokenize(title)
      tokens.set(title, set)
    }
    return set
  }

  for (const article of articles) {
    const articleTime = article.published_at
      ? new Date(article.published_at).getTime()
      : 0

    let matched = false

    for (const cluster of clusters) {
      const repTime = cluster.representative.published_at
        ? new Date(cluster.representative.published_at).getTime()
        : 0

      if (Math.abs(articleTime - repTime) > CLUSTER_WINDOW_MS) continue

      if (similarity(tokensFor(article.title), tokensFor(cluster.representative.title)) >= CLUSTER_THRESHOLD) {
        cluster.articles.push(article)
        // distinct outlets, matching the DB-cluster path above (groupByClusterId)
        cluster.sourceCount = new Set(cluster.articles.map(a => a.source_name)).size
        matched = true
        break
      }
    }

    if (!matched) {
      clusters.push({
        id: article.id,
        representative: article,
        articles: [article],
        sourceCount: 1,
      })
    }
  }

  return clusters
}
