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

const CLUSTER_THRESHOLD = 0.4
const CLUSTER_WINDOW_MS = 8 * 60 * 60 * 1000

function tokenize(title: string): Set<string> {
  return new Set(
    title.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w))
  )
}

function similarity(a: string, b: string): number {
  const setA = tokenize(a)
  const setB = tokenize(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const word of setA) {
    if (setB.has(word)) intersection++
  }
  return intersection / Math.min(setA.size, setB.size)
}

export function groupByClusterId(articles: Article[]): Cluster[] {
  const map = new Map<string, Article[]>()
  for (const a of articles) {
    const key = a.cluster_id ?? a.id
    const group = map.get(key) ?? []
    group.push(a)
    map.set(key, group)
  }
  return [...map.values()].map(group => ({
    id: group[0].cluster_id ?? group[0].id,
    representative: group[0],
    articles: group,
    sourceCount: new Set(group.map(a => a.source_name)).size,
  }))
}

export function clusterArticles(articles: Article[]): Cluster[] {
  const clusters: Cluster[] = []

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

      if (similarity(article.title, cluster.representative.title) >= CLUSTER_THRESHOLD) {
        cluster.articles.push(article)
        cluster.sourceCount = cluster.articles.length
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
