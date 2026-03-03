# Top Stories Design

## Goal
Show the 3 most-covered stories from the last hour in a pinned strip above the filter bar, immediately orienting new visitors to what's happening right now.

## Data

### Source
- A separate `$derived(clusterArticles(articles))` pass — unfiltered, global, independent of the user's active region/search filters
- `topStories` = filter to clusters where `rep.published_at` is within the last hour, sort by `sourceCount` desc, take top 3
- If 0 stories qualify (quiet period), strip does not render

### Why separate from `clustered`
`clustered` derives from `filtered` — it responds to the user's region filter. Top stories must be global. Running a second `clusterArticles(articles)` pass costs ~2ms for 1500 articles and reuses the existing algorithm with no new logic.

## Layout

Sits between the header and the FilterBar. Three cards in a flex-wrap row within `max-w-3xl`. Each card is approximately 1/3 width on desktop; wraps on narrow screens.

### Section label
`TRENDING NOW` — `text-[10px] uppercase tracking-widest text-gray-600`, above the card row.

### Each card
```
┌──────────────────────┐
│ [Region]       14m   │
│ Headline line one    │
│ headline line two    │
│                      │
│ 7 sources            │
└──────────────────────┘
```

- Region badge (representative's region) + `timeAgo` pushed right — same pattern as feed cards
- Headline: 2-line clamp, links to `rep.url` in new tab
- `N sources` in `text-gray-500` at bottom — the heat signal
- Background: `bg-[#0d0d0f]`, thin border `border-gray-800`, left border in representative's region color
- Visually distinct from feed cards below but consistent with the existing palette

## Files

- **Create:** `src/lib/components/TopStories.svelte` — accepts `{ stories: Cluster[] }` prop (already sliced to top 3)
- **Modify:** `src/routes/+page.svelte` — add `allClustered` and `topStories` deriveds, render `<TopStories>` between header and FilterBar

## Not In Scope
- Clicking a card scrolling to the story in the feed (just link to rep URL)
- Configurable window (hardcoded 1 hour)
- Tests (pure presentational)
- "Breaking" badge on top story cards (already handled by ClusterCard in the feed)
