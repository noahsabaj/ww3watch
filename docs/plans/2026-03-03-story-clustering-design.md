# Story Clustering Design

## Goal
Group articles covering the same event into a single expandable card, reducing visual noise while showcasing the multi-source perspective that makes WW3Watch unique.

## Algorithm
Pure client-side title similarity. No DB changes, no backend work. Runs on the already-loaded `filtered` array in the browser.

- **Tokenize**: lowercase, strip stopwords (`the`, `a`, `in`, `on`, `at`, `says`, `said`, etc.), keep words ≥ 3 chars
- **Similarity**: `intersection / min(sizeA, sizeB)` — asymmetric so short titles match long ones
- **Time window**: 8 hours — same story gets picked up for hours
- **Threshold**: 0.4
- Articles are pre-sorted `published_at desc`, so first match = most recent = representative

## Types
```typescript
export interface Cluster {
  id: string          // representative article's id
  representative: Article
  articles: Article[] // sorted by published_at desc
  sourceCount: number
}
```

## New Files
- `src/lib/cluster.ts` — `clusterArticles(articles: Article[]): Cluster[]`
- `src/lib/cluster.test.ts` — TDD tests
- `src/lib/components/ClusterCard.svelte` — cluster card UI

## Modified Files
- `src/routes/+page.svelte` — toggle state, clustered derived, ClusterCard render

## UI

### ClusterCard
- 1 article: renders identically to current ArticleCard (zero regression)
- 2+ articles:
  - Same colored left border as representative's region
  - Representative's headline + summary
  - Row of colored region dots (up to 5) + "N sources" badge
  - Collapsed: "▾ N sources covered this" bar
  - Expanded: each article as compact row — `[RegionBadge] [Source] [Headline link] [timeAgo]`

### Toggle
- Header top-right, next to article count
- Default: ON (clustered)
- Label: "X stories" when ON, "X articles" when OFF
- Single `let clusterMode = $state(true)` in +page.svelte
- `let clustered = $derived(clusterArticles(filtered))`
