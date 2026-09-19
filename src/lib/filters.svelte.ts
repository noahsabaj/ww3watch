// Feed filters + ordering, extracted from routes/+page.svelte.
//
// Two halves:
//   • PURE helpers (filterArticles, orderClusters, the chip counters …) — plain
//     functions, unit-tested in filters.test.ts.
//   • createFilters(): the reactive filter state for ONE mount of the feed page.
//     It is a factory, not a module singleton like now.svelte.ts/prefs.svelte.ts,
//     because the state it replaces was component-local: filters reset when the
//     page remounts, and that lifetime is preserved. Call it during component
//     initialisation.
import type { Article, SourceRegion } from './types'
import { ALL_REGIONS } from './types'
import { importance } from './story'
import { ALL_TOPICS, emptySignalFilter, matchesSignals, signalFilterActive, type Actor, type SignalFilter, type Topic } from './signals'
import { groupByStoryId } from './cluster'
import type { Cluster } from './cluster'
import { clock } from './now.svelte'

export type SortMode = 'latest' | 'top'

export interface FilterCriteria {
  searchQuery: string
  activeRegions: Set<SourceRegion>
  excludedLangs: Set<string>
  signalFilter: SignalFilter
}

export const TOP_WINDOW_MS = 24 * 3_600_000

const SORT_STORAGE_KEY = 'feed-sort'

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function isFilterActive(f: FilterCriteria): boolean {
  return f.searchQuery.trim() !== '' || f.activeRegions.size < ALL_REGIONS.length || f.excludedLangs.size > 0 || signalFilterActive(f.signalFilter)
}

export function filterArticles(articles: Article[], f: FilterCriteria): Article[] {
  return articles.filter(a => {
    const matchesRegion = f.activeRegions.has(a.source_region)
    const matchesLang = !f.excludedLangs.has(a.source_lang)
    const q = f.searchQuery.trim().toLowerCase()
    const matchesSearch = q === '' ||
      a.title.toLowerCase().includes(q) ||
      (a.summary ?? '').toLowerCase().includes(q)
    return matchesRegion && matchesLang && matchesSearch && matchesSignals(a, f.signalFilter)
  })
}

// The 'top' ordering: stories whose newest member is inside the last
// TOP_WINDOW_MS, ranked by importance. Undated stories never qualify.
export function rankTop(latestClustered: Cluster[], now: number): Cluster[] {
  const newest = (c: Cluster) => (c.representative.published_at ? Date.parse(c.representative.published_at) : null)
  return latestClustered
    .filter((c) => { const t = newest(c); return t !== null && now - t < TOP_WINDOW_MS })
    .map((c) => ({ c, score: importance(c.articles, newest(c), now) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c)
}

// Languages present in the loaded feed, most common first — the chips the
// filter UI offers. Counted over the unfiltered list so a chip never
// disappears because you excluded it.
export function countLangs(articles: Article[]): { lang: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const a of articles) counts.set(a.source_lang, (counts.get(a.source_lang) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([lang, count]) => ({ lang, count }))
}

// Topic / actor chips: only what the loaded feed actually contains, most
// common first, counted over the unfiltered list (same rule as languages).
export function countTopics(articles: Article[]): { key: Topic; count: number }[] {
  const counts = new Map<Topic, number>()
  for (const a of articles) if (a.topic) counts.set(a.topic, (counts.get(a.topic) ?? 0) + 1)
  return ALL_TOPICS.filter((k) => counts.has(k)).map((key) => ({ key, count: counts.get(key)! }))
}
export function countActors(articles: Article[]): { key: Actor; count: number }[] {
  const counts = new Map<Actor, number>()
  for (const a of articles) for (const k of a.actors ?? []) counts.set(k, (counts.get(k) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }))
}

// ── Reactive state ───────────────────────────────────────────────────────────

/**
 * Filter + sort state for one mount of the feed page, plus the derivations that
 * hang off it. `getArticles` must read the (reactive) unfiltered article list.
 * The four filter fields are get/set so components can `bind:` to them.
 */
export function createFilters(getArticles: () => Article[]) {
  let searchQuery = $state('')
  let activeRegions = $state(new Set<SourceRegion>(ALL_REGIONS))
  // Language filter is an EXCLUSION set (empty = everything), unlike regions:
  // the language list is whatever the loaded feed contains, so a language that
  // first appears via realtime must show by default rather than be silently
  // filtered out by a "selected" set that predates it.
  let excludedLangs = $state(new Set<string>())
  let signalFilter = $state<SignalFilter>(emptySignalFilter())

  // Feed order. 'latest' is the chronological feed. 'top' ranks the last day's
  // stories by importance (severity, corroboration, recency — src/lib/story.ts):
  // the same ingredients as Trending, over everything instead of the top three.
  let sortMode = $state<SortMode>('latest')

  const criteria: FilterCriteria = {
    get searchQuery() { return searchQuery },
    get activeRegions() { return activeRegions },
    get excludedLangs() { return excludedLangs },
    get signalFilter() { return signalFilter },
  }

  let isFiltered = $derived(isFilterActive(criteria))

  let availableLangs = $derived(countLangs(getArticles()))
  let availableTopics = $derived(countTopics(getArticles()))
  let availableActors = $derived(countActors(getArticles()))

  let filtered = $derived(filterArticles(getArticles(), criteria))
  let latestClustered = $derived(groupByStoryId(filtered))
  // Time-derived: 'top' reads the shared clock so its window slides.
  let clustered = $derived(sortMode === 'latest' ? latestClustered : rankTop(latestClustered, clock.now))

  function setSortMode(mode: SortMode) {
    sortMode = mode
    try { localStorage.setItem(SORT_STORAGE_KEY, mode) } catch { /* private mode */ }
  }

  /** Read the persisted sort mode. Browser-only — call from onMount. */
  function restoreSortMode() {
    try { if (localStorage.getItem(SORT_STORAGE_KEY) === 'top') sortMode = 'top' } catch { /* private mode */ }
  }

  function clearFilters() {
    searchQuery = ''
    activeRegions = new Set(ALL_REGIONS)
    excludedLangs = new Set()
    signalFilter = emptySignalFilter()
  }

  return {
    get searchQuery() { return searchQuery },
    set searchQuery(v: string) { searchQuery = v },
    get activeRegions() { return activeRegions },
    set activeRegions(v: Set<SourceRegion>) { activeRegions = v },
    get excludedLangs() { return excludedLangs },
    set excludedLangs(v: Set<string>) { excludedLangs = v },
    get signalFilter() { return signalFilter },
    set signalFilter(v: SignalFilter) { signalFilter = v },
    get sortMode() { return sortMode },
    get isFiltered() { return isFiltered },
    get availableLangs() { return availableLangs },
    get availableTopics() { return availableTopics },
    get availableActors() { return availableActors },
    /** Filtered articles grouped into stories, chronological (DESC). */
    get latestClustered() { return latestClustered },
    /** What the feed renders: latestClustered, or its Top · 24h ranking. */
    get clustered() { return clustered },
    setSortMode,
    restoreSortMode,
    clearFilters,
  }
}

export type Filters = ReturnType<typeof createFilters>
