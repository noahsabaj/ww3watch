# Story Clustering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Group articles covering the same event into a single expandable card with a source count badge and per-source dropdown.

**Architecture:** Pure client-side title-similarity clustering. New `cluster.ts` module runs on the already-filtered `Article[]` array in the browser — no DB changes, no backend work. `ClusterCard.svelte` renders single-article clusters identically to the current `ArticleCard`, and multi-article clusters with an expandable source list. A toggle in the header (default ON) switches between clustered and flat views.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, TypeScript, Vitest, Tailwind v4

---

### Task 1: Create cluster.ts with TDD

**Files:**
- Create: `src/lib/cluster.ts`
- Create: `src/lib/cluster.test.ts`

**Step 1: Write the failing tests**

Create `src/lib/cluster.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { clusterArticles } from './cluster'
import type { Article } from './types'

function makeArticle(id: string, title: string, published_at?: string | null): Article {
  return {
    id,
    guid: id,
    title,
    url: `https://example.com/${id}`,
    summary: null,
    published_at: published_at !== undefined ? published_at : new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_name: 'Test Source',
    source_region: 'US/Western',
    source_lang: 'en',
    feed_url: 'https://example.com/rss',
  }
}

describe('clusterArticles', () => {
  it('wraps a single article in a single cluster', () => {
    const articles = [makeArticle('1', 'Iran launches missile strike on Israel')]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sourceCount).toBe(1)
    expect(clusters[0].representative.id).toBe('1')
  })

  it('clusters two articles with similar titles', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', now),
      makeArticle('2', 'Iran launches missile strike targeting Israel', now),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sourceCount).toBe(2)
  })

  it('does not cluster articles with unrelated titles', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', now),
      makeArticle('2', 'Lebanon arrests foreign nationals collaboration', now),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(2)
  })

  it('does not cluster articles outside the 8-hour window', () => {
    const now = Date.now()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', new Date(now).toISOString()),
      makeArticle('2', 'Iran launches missile strike on Israel', new Date(now - 9 * 60 * 60 * 1000).toISOString()),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(2)
  })

  it('uses the first article as the cluster representative', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', now),
      makeArticle('2', 'Iran launches missiles strike on Israel', now),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters[0].representative.id).toBe('1')
  })

  it('handles articles with null published_at without throwing', () => {
    const articles = [
      makeArticle('1', 'Iran strikes Israel', null),
      makeArticle('2', 'Iran strikes Israel again', null),
    ]
    expect(() => clusterArticles(articles)).not.toThrow()
  })

  it('clusters three articles about the same event', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Israel bombs Iranian nuclear facility Natanz', now),
      makeArticle('2', 'Israel bombs nuclear facility Natanz Iran', now),
      makeArticle('3', 'Israeli strike bombs nuclear facility Natanz', now),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sourceCount).toBe(3)
  })
})
```

**Step 2: Run tests to verify they FAIL**

```bash
cd D:/Code/ww3watch && npm run test -- cluster
```
Expected: fail with "Cannot find module './cluster'"

**Step 3: Implement cluster.ts**

Create `src/lib/cluster.ts`:

```typescript
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
```

**Step 4: Run tests to verify they PASS**

```bash
npm run test -- cluster
```
Expected: 7/7 passing

**Step 5: Commit**

```bash
git add src/lib/cluster.ts src/lib/cluster.test.ts
git commit -m "feat: add story clustering algorithm with TDD"
```

---

### Task 2: Create ClusterCard.svelte

**Files:**
- Create: `src/lib/components/ClusterCard.svelte`

**Step 1: Create the component**

Create `src/lib/components/ClusterCard.svelte`:

```svelte
<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import { REGION_COLORS, REGION_BORDER } from '$lib/types'

  let { cluster }: { cluster: Cluster } = $props()
  let expanded = $state(false)

  function timeAgo(dateStr: string | null): string {
    if (!dateStr) return ''
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  function langFlag(lang: string): string {
    const flags: Record<string, string> = {
      fa: '🇮🇷', ar: '🇸🇦', he: '🇮🇱', ru: '🇷🇺',
      zh: '🇨🇳', tr: '🇹🇷', fr: '🇫🇷', de: '🇩🇪', ur: '🇵🇰',
    }
    return flags[lang] ?? ''
  }

  const rep = $derived(cluster.representative)
  const others = $derived(cluster.articles.slice(1))
  const isSingle = $derived(cluster.sourceCount === 1)
  const regionDots = $derived(
    [...new Set(cluster.articles.map(a => a.source_region))].slice(0, 5)
  )
</script>

<article class="border-l-4 {REGION_BORDER[rep.source_region]} bg-[#111113] hover:bg-[#18181b] transition-colors px-4 py-3">
  <!-- Header row -->
  <div class="flex items-center gap-2 mb-1.5 flex-wrap">
    <span class="text-xs font-semibold px-2 py-0.5 rounded {REGION_COLORS[rep.source_region]}">
      {rep.source_region}
    </span>
    <span class="text-sm font-medium text-gray-300">
      {langFlag(rep.source_lang)}{langFlag(rep.source_lang) ? ' ' : ''}{rep.source_name}
    </span>
    {#if !isSingle}
      <div class="flex items-center gap-1 ml-1">
        {#each regionDots as region}
          <span class="w-2 h-2 rounded-full {REGION_COLORS[region].split(' ')[0]}"></span>
        {/each}
        <span class="text-xs text-gray-400 font-medium ml-0.5">+{cluster.sourceCount - 1} more</span>
      </div>
    {/if}
    <span class="text-xs text-gray-500 ml-auto">{timeAgo(rep.published_at)}</span>
  </div>

  <!-- Headline -->
  <a
    href={rep.url}
    target="_blank"
    rel="noopener noreferrer"
    class="block text-white font-semibold leading-snug hover:text-blue-400 transition-colors mb-1"
  >
    {rep.title}
  </a>

  <!-- Summary -->
  {#if rep.summary}
    <p class="text-sm text-gray-400 line-clamp-2 mb-2">{rep.summary}</p>
  {/if}

  <!-- Expand toggle -->
  {#if !isSingle}
    <button
      onclick={() => expanded = !expanded}
      class="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors mt-1"
    >
      <span class="inline-block transition-transform {expanded ? 'rotate-180' : ''}">▾</span>
      {expanded ? 'Hide sources' : `${cluster.sourceCount} sources covered this`}
    </button>

    {#if expanded}
      <div class="mt-2 space-y-1 border-t border-gray-800 pt-2">
        {#each others as article (article.id)}
          <div class="flex items-center gap-2 py-0.5">
            <span class="text-xs font-semibold px-1.5 py-0.5 rounded shrink-0 {REGION_COLORS[article.source_region]}">
              {article.source_region}
            </span>
            <span class="text-xs text-gray-400 shrink-0">
              {langFlag(article.source_lang)}{article.source_name}
            </span>
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-gray-300 hover:text-blue-400 transition-colors line-clamp-1 flex-1 min-w-0"
            >
              {article.title}
            </a>
            <span class="text-xs text-gray-600 shrink-0">{timeAgo(article.published_at)}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</article>
```

**Step 2: Run type-check**

```bash
npm run check
```
Expected: 0 errors, 0 warnings

**Step 3: Commit**

```bash
git add src/lib/components/ClusterCard.svelte
git commit -m "feat: add ClusterCard component with expandable source list"
```

---

### Task 3: Wire clustering into +page.svelte

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Apply these changes to `src/routes/+page.svelte`**

Add two imports at the top of the `<script>` block (after existing imports):
```typescript
import { clusterArticles } from '$lib/cluster'
import ClusterCard from '$lib/components/ClusterCard.svelte'
```

Add one new state variable after `let activeRegions = ...`:
```typescript
let clusterMode = $state(true)
```

Add one new derived after `let filtered = ...`:
```typescript
let clustered = $derived(clusterArticles(filtered))
```

**Replace the header article count span:**
```svelte
<span class="text-xs text-gray-500">
  {clusterMode
    ? `${clustered.length.toLocaleString()} stories`
    : `${filtered.length.toLocaleString()} articles`}
</span>
```

**Add the cluster toggle button** in the header, right before the article count span:
```svelte
<button
  onclick={() => clusterMode = !clusterMode}
  class="text-xs px-2 py-1 rounded border transition-colors {clusterMode
    ? 'border-blue-500 text-blue-400 bg-blue-500/10'
    : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'}"
>
  Cluster
</button>
```

**Replace the feed `{#each}` block** (lines 98-100 in current file):
```svelte
{#if clusterMode}
  {#each clustered as cluster (cluster.id)}
    <ClusterCard {cluster} />
  {/each}
{:else}
  {#each filtered as article (article.id)}
    <ArticleCard {article} />
  {/each}
{/if}
```

**Step 2: Run type-check**

```bash
npm run check
```
Expected: 0 errors, 0 warnings

**Step 3: Run all tests**

```bash
npm run test
```
Expected: all tests passing (7 cluster + 6 relevance + 8 rss = 21 total)

**Step 4: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: wire story clustering into feed with toggle — default ON"
```

---

### Task 4: Push and verify

**Step 1: Push**

```bash
git push
```

**Step 2: Verify on live site after Vercel deploys (~60s)**

Open `https://ww3watch.vercel.app`. Confirm:
- Default view shows clustered stories with colored region dots and "N sources" badges
- Clicking "▾ N sources covered this" expands the source list
- "Cluster" button in header is highlighted blue (ON state)
- Clicking it switches to flat article view and button goes grey
- Header count says "X stories" in cluster mode, "X articles" in flat mode
