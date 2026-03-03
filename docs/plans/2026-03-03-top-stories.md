# Top Stories Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Trending Now" strip above the filter bar showing the 3 most-covered stories from the last hour, derived from the full unfiltered article set.

**Architecture:** A second `clusterArticles(articles)` pass runs independently of the filtered feed, producing `allClustered`. `topStories` filters to last-hour clusters, sorts by `sourceCount` desc, takes top 3. A new `TopStories.svelte` component renders the strip. No backend changes, no new data fetching.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, TypeScript, Tailwind v4

---

### Task 1: Create TopStories.svelte

**Files:**
- Create: `src/lib/components/TopStories.svelte`

**Step 1: Create the component**

Create `src/lib/components/TopStories.svelte` with this exact content:

```svelte
<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import { REGION_COLORS, REGION_BORDER } from '$lib/types'

  let { stories }: { stories: Cluster[] } = $props()

  function timeAgo(dateStr: string | null): string {
    if (!dateStr) return 'unknown time'
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }
</script>

{#if stories.length > 0}
  <div class="border-b border-gray-800 bg-[#0a0a0b]">
    <div class="max-w-3xl mx-auto px-4 pt-3 pb-3">
      <p class="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Trending Now</p>
      <div class="flex gap-2 flex-wrap">
        {#each stories as cluster (cluster.id)}
          {@const rep = cluster.representative}
          <a
            href={rep.url}
            target="_blank"
            rel="noopener noreferrer"
            class="flex-1 min-w-[180px] border-l-4 {REGION_BORDER[rep.source_region]} bg-[#0d0d0f] hover:bg-[#131315] transition-colors px-3 py-2.5"
          >
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <span class="text-xs font-semibold px-1.5 py-0.5 rounded {REGION_COLORS[rep.source_region]}">
                {rep.source_region}
              </span>
              <span class="text-xs text-gray-600">{timeAgo(rep.published_at)}</span>
            </div>
            <p class="text-sm font-semibold text-white leading-snug line-clamp-2 mb-2">
              {rep.title}
            </p>
            <p class="text-xs text-gray-500">{cluster.sourceCount} {cluster.sourceCount === 1 ? 'source' : 'sources'}</p>
          </a>
        {/each}
      </div>
    </div>
  </div>
{/if}
```

**Step 2: Run type-check**

```bash
cd D:/Code/ww3watch && npm run check
```

Expected: 0 errors, 0 warnings

**Step 3: Commit**

```bash
git add src/lib/components/TopStories.svelte
git commit -m "feat: add TopStories component for trending now strip"
```

---

### Task 2: Wire TopStories into +page.svelte

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Add the import**

In the `<script>` block, add after the existing component imports (after the `ClusterCard` import line):

```typescript
import TopStories from '$lib/components/TopStories.svelte'
```

**Step 2: Add the derived state**

Add these three lines after `let clustered = $derived(clusterArticles(filtered))`:

```typescript
const TOP_STORIES_WINDOW_MS = 60 * 60 * 1000
let allClustered = $derived(clusterArticles(articles))
let topStories = $derived(
  allClustered
    .filter(c =>
      c.representative.published_at
        ? Date.now() - new Date(c.representative.published_at).getTime() < TOP_STORIES_WINDOW_MS
        : false
    )
    .sort((a, b) => b.sourceCount - a.sourceCount)
    .slice(0, 3)
)
```

**Step 3: Render TopStories in the template**

In the template, find the `<!-- Filter Bar -->` comment and the `<FilterBar>` line:

```svelte
  <!-- Filter Bar -->
  <FilterBar bind:activeRegions bind:searchQuery />
```

Replace with:

```svelte
  <!-- Trending Now -->
  <TopStories stories={topStories} />

  <!-- Filter Bar -->
  <FilterBar bind:activeRegions bind:searchQuery />
```

**Step 4: Run type-check and all tests**

```bash
cd D:/Code/ww3watch && npm run check && npm run test
```

Expected: 0 errors, 0 warnings, 21/21 tests passing

**Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: wire TopStories into feed — trending now strip above filter bar"
```

---

### Task 3: Push and verify

**Step 1: Push**

```bash
git push
```

**Step 2: Verify on live site after Vercel deploys (~60s)**

Open `https://ww3watch.vercel.app`. Confirm:
- "TRENDING NOW" strip appears between the header and the filter bar
- Shows up to 3 cards, each with a colored left border, region badge, headline (2-line clamp), source count, and timestamp
- Cards link to the representative article URL in a new tab
- If fewer than 3 stories were published in the last hour, fewer than 3 cards appear (or none, and the strip is hidden entirely)
- Applying a region filter does NOT change the top stories strip — it always shows global results
- The feed below updates normally with the filter
