import type { Article } from './types'
import type { Cluster } from './cluster'
import { headlineText } from './utils'

/** Shared links deliberately omit the visitor's filters and location. */
export function shareTarget(
  article: Pick<Article, 'id' | 'title'>,
  cluster?: Pick<Cluster, 'storyId' | 'sourceCount'> | null,
) {
  const kind = cluster?.storyId && cluster.sourceCount > 1 ? 'story' : 'article'
  const id = kind === 'story' ? cluster!.storyId! : article.id
  return {
    kind,
    url: `https://ww3watch.org/?${kind}=${encodeURIComponent(id)}`,
    title: headlineText(article.title),
  }
}
