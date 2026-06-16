import type { Article } from './types'

export interface Cluster {
  /** Grouping key: the story uuid, or the article's own id for singletons. */
  id: string
  /** The real stories.id when the group came from the DB; null for unassigned singletons. */
  storyId: string | null
  representative: Article
  articles: Article[]
  sourceCount: number
}

function ts(a: Article): number {
  return a.published_at ? new Date(a.published_at).getTime() : 0
}

// Members sharing a body_hash are reprints of the same agency copy. Returns the
// ids of every copy EXCEPT the earliest-published one (the origin), so wire
// reprints can be badged in the UI and excluded from independent-source counts
// (ClusterCard badges them; trending collapses them before ranking). Shared so
// the two never drift.
export function wireDuplicateIds(articles: Article[]): Set<string> {
  const byHash = new Map<string, Article[]>()
  for (const a of articles) {
    if (!a.body_hash) continue
    const g = byHash.get(a.body_hash)
    if (g) g.push(a)
    else byHash.set(a.body_hash, [a])
  }
  const ids = new Set<string>()
  for (const group of byHash.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((x, y) =>
      (x.published_at ?? '9999').localeCompare(y.published_at ?? '9999'))
    for (const copy of sorted.slice(1)) ids.add(copy.id)
  }
  return ids
}

// Groups articles by their pipeline-assigned story_id (multilingual embedding
// clustering, assign_story_by_embedding). Articles without one — junk-titled
// or not-yet-assigned rows — render as singletons by design; there is no
// client-side fallback clustering anymore.
//
// `?? a.id` also tolerates story_id === undefined: the service worker can
// serve cached pre-stories REST rows for a session after a deploy.
//
// Representative = newest member by published_at (display choice — matches
// the feed's day-separator assumption), kept at articles[0] (consumers render
// articles.slice(1) as "the others"). Output sorted by representative
// published_at DESC, nulls last.
export function groupByStoryId(articles: Article[]): Cluster[] {
  const groups = new Map<string, Article[]>()
  for (const a of articles) {
    const key = a.story_id ?? a.id
    const g = groups.get(key)
    if (g) g.push(a)
    else groups.set(key, [a])
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const representative = group.reduce((best, a) => (ts(a) > ts(best) ? a : best), group[0])
      return {
        id: key,
        storyId: group[0].story_id ?? null,
        representative,
        articles: [representative, ...group.filter((a) => a !== representative)],
        sourceCount: new Set(group.map((a) => a.source_name)).size,
      }
    })
    .sort((a, b) => ts(b.representative) - ts(a.representative))
}
