// Headline search: the feed's only way to narrow. Everything else is the whole
// feed, newest first; the filter sheet (regions, languages, topics, places,
// kinds of story) was removed as more than most readers would ever learn.
//
// createSearch() is a factory, not a module singleton: the query resets when
// the page remounts. Call it during component initialisation.
import type { Article } from './types'
import { groupByStoryId } from './cluster'
import { leadLangs } from './prefs.svelte'

/** Title or summary contains the query, ignoring case and surrounding spaces. */
export function searchArticles(articles: Article[], query: string): Article[] {
  const q = query.trim().toLowerCase()
  if (q === '') return articles
  return articles.filter((a) => a.title.toLowerCase().includes(q) || (a.summary ?? '').toLowerCase().includes(q))
}

/** `getArticles` must read the (reactive) unfiltered article list. */
export function createSearch(getArticles: () => Article[]) {
  let query = $state('')
  const active = $derived(query.trim() !== '')
  const clustered = $derived(groupByStoryId(searchArticles(getArticles(), query), leadLangs()))

  return {
    get query() { return query },
    set query(v: string) { query = v },
    /** A query is narrowing the feed. */
    get active() { return active },
    /** Matching articles grouped into stories, newest first. */
    get clustered() { return clustered },
    clear() { query = '' },
  }
}

export type Search = ReturnType<typeof createSearch>
