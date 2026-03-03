# Article Reader Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Slide-in right panel that opens when clicking any article card, shows RSS summary instantly + shimmer, then swaps in full article content fetched server-side.

**Architecture:** New `/api/reader?url=...` SvelteKit server route uses `linkedom` + `@mozilla/readability` to extract article content. New `ArticlePanel.svelte` renders the panel. Cards gain an `onselect` callback prop; `+page.svelte` wires selection state.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Tailwind v4, `@mozilla/readability`, `linkedom`

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via npm install)

**Step 1: Install**

```bash
npm install @mozilla/readability linkedom
```

**Step 2: Verify**

```bash
npm run check
```
Expected: 0 errors, 0 warnings.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add readability and linkedom dependencies"
```

---

### Task 2: Create the extraction logic (pure, testable)

**Files:**
- Create: `src/lib/server/reader.ts`
- Create: `src/lib/server/reader.test.ts`

**Step 1: Write failing tests**

Create `src/lib/server/reader.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { extractArticle } from './reader'

describe('extractArticle', () => {
  it('returns null on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'))
    const result = await extractArticle('https://example.com/article')
    expect(result).toBeNull()
  })

  it('returns null on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    )
    const result = await extractArticle('https://example.com/article')
    expect(result).toBeNull()
  })

  it('returns null on timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError')
    )
    const result = await extractArticle('https://example.com/article')
    expect(result).toBeNull()
  })

  it('returns extracted article from valid HTML', async () => {
    const html = `<!DOCTYPE html><html><head><title>Test Article</title></head>
    <body><article><p>This is a test article with enough content to be extracted by Readability. It needs several sentences to pass the minimum word count threshold that Mozilla Readability requires before it considers content worth extracting.</p></article></body></html>`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })
    )
    const result = await extractArticle('https://example.com/article')
    expect(result).not.toBeNull()
    expect(result?.content).toContain('test article')
  })

  it('returns null when Readability finds no content', async () => {
    const html = `<!DOCTYPE html><html><body><div>hi</div></body></html>`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })
    )
    const result = await extractArticle('https://example.com/article')
    expect(result).toBeNull()
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm test -- reader.test
```
Expected: FAIL — "Cannot find module './reader'"

**Step 3: Implement `src/lib/server/reader.ts`**

```typescript
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

export interface ArticleContent {
  title: string
  byline: string | null
  content: string
  siteName: string | null
}

export async function extractArticle(url: string): Promise<ArticleContent | null> {
  let html: string
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WW3Watch/1.0; +https://ww3watch.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    html = await res.text()
  } catch {
    return null
  }

  try {
    const { document } = parseHTML(html)
    const reader = new Readability(document as unknown as Document)
    const article = reader.parse()
    if (!article) return null
    return {
      title: article.title,
      byline: article.byline,
      content: article.content,
      siteName: article.siteName,
    }
  } catch {
    return null
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- reader.test
```
Expected: PASS — all 5 tests green.

**Step 5: Commit**

```bash
git add src/lib/server/reader.ts src/lib/server/reader.test.ts
git commit -m "feat: add server-side article content extractor"
```

---

### Task 3: Create the API route

**Files:**
- Create: `src/routes/api/reader/+server.ts`

**Step 1: Create the route**

```typescript
import { json } from '@sveltejs/kit'
import { extractArticle } from '$lib/server/reader'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ url }) => {
  const articleUrl = url.searchParams.get('url')
  if (!articleUrl) return json({ error: 'missing_url' }, { status: 400 })

  // Basic URL validation — must be http/https
  try {
    const parsed = new URL(articleUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return json({ error: 'invalid_url' }, { status: 400 })
    }
  } catch {
    return json({ error: 'invalid_url' }, { status: 400 })
  }

  const article = await extractArticle(articleUrl)
  if (!article) return json({ error: 'extraction_failed' }, { status: 422 })

  return json(article)
}
```

**Step 2: Type-check**

```bash
npm run check
```
Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/routes/api/reader/+server.ts
git commit -m "feat: add /api/reader route for server-side article extraction"
```

---

### Task 4: Create ArticlePanel.svelte

**Files:**
- Create: `src/lib/components/ArticlePanel.svelte`

The panel receives an `Article` and manages its own fetch lifecycle.

**Step 1: Create the component**

```svelte
<script lang="ts">
  import type { Article } from '$lib/types'
  import { REGION_COLORS, REGION_BORDER } from '$lib/types'
  import { timeAgo } from '$lib/utils'

  let { article, onclose }: {
    article: Article | null
    onclose: () => void
  } = $props()

  type ReaderState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'loaded'; title: string; byline: string | null; content: string }
    | { status: 'failed' }

  let reader = $state<ReaderState>({ status: 'idle' })

  $effect(() => {
    if (!article) {
      reader = { status: 'idle' }
      return
    }
    reader = { status: 'loading' }
    fetch(`/api/reader?url=${encodeURIComponent(article.url)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          reader = { status: 'failed' }
        } else {
          reader = { status: 'loaded', title: data.title, byline: data.byline, content: data.content }
        }
      })
      .catch(() => { reader = { status: 'failed' } })
  })

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if article}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/50 z-40"
    onclick={onclose}
    role="presentation"
  ></div>

  <!-- Panel -->
  <aside
    class="fixed top-0 right-0 h-full w-full md:w-[45%] lg:w-[38%] bg-[#0a0a0b] border-l border-gray-800 z-50 flex flex-col"
    style="animation: slideIn 200ms ease-out;"
  >
    <!-- Top bar -->
    <div class="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0 flex-wrap">
      <span class="text-xs font-semibold px-2 py-0.5 rounded {REGION_COLORS[article.source_region]}">
        {article.source_region}
      </span>
      <span class="text-sm font-medium text-gray-300">{article.source_name}</span>
      <span class="text-xs text-gray-500">{timeAgo(article.published_at)}</span>
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        class="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        Read original ↗
      </a>
      <button
        onclick={onclose}
        class="text-gray-500 hover:text-gray-200 transition-colors text-lg leading-none ml-2"
        aria-label="Close reader"
      >
        ✕
      </button>
    </div>

    <!-- Content area -->
    <div class="flex-1 overflow-y-auto px-6 py-5">

      {#if reader.status === 'loading'}
        <!-- Shimmer skeleton -->
        <div class="animate-pulse space-y-3">
          <div class="h-7 bg-gray-800 rounded w-3/4 shimmer"></div>
          <div class="h-7 bg-gray-800 rounded w-1/2 shimmer"></div>
          <div class="h-4 bg-gray-800/60 rounded w-1/3 mt-4 shimmer"></div>
          <div class="space-y-2 mt-6">
            <div class="h-4 bg-gray-800 rounded shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-11/12 shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-full shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-10/12 shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-full shimmer"></div>
          </div>
          <div class="space-y-2 mt-4">
            <div class="h-4 bg-gray-800 rounded w-full shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-9/12 shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-full shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-11/12 shimmer"></div>
          </div>
        </div>

      {:else if reader.status === 'loaded'}
        <h1 class="text-xl font-bold text-white leading-snug mb-2">{reader.title}</h1>
        {#if reader.byline}
          <p class="text-xs text-gray-500 mb-5">{reader.byline}</p>
        {/if}
        <div class="prose-reader">
          {@html reader.content}
        </div>

      {:else if reader.status === 'failed'}
        <h1 class="text-xl font-bold text-white leading-snug mb-3">{article.title}</h1>
        {#if article.summary}
          <p class="text-gray-300 leading-relaxed mb-6">{article.summary}</p>
        {/if}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-block text-sm border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors px-3 py-1.5 rounded"
        >
          Full article unavailable — read original ↗
        </a>
      {/if}

    </div>
  </aside>
{/if}

<style>
  @keyframes slideIn {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }

  .shimmer {
    background: linear-gradient(
      90deg,
      theme('colors.gray.800') 25%,
      theme('colors.gray.700') 50%,
      theme('colors.gray.800') 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite;
  }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Prose styles for Readability HTML output */
  :global(.prose-reader p)      { color: theme('colors.gray.300'); line-height: 1.75; margin-bottom: 1rem; font-size: 0.9375rem; }
  :global(.prose-reader h1),
  :global(.prose-reader h2),
  :global(.prose-reader h3)     { color: white; font-weight: 600; margin: 1.5rem 0 0.5rem; }
  :global(.prose-reader a)      { color: theme('colors.blue.400'); text-decoration: underline; }
  :global(.prose-reader img)    { max-width: 100%; border-radius: 4px; margin: 1rem 0; }
  :global(.prose-reader ul),
  :global(.prose-reader ol)     { color: theme('colors.gray.300'); padding-left: 1.5rem; margin-bottom: 1rem; line-height: 1.75; }
  :global(.prose-reader blockquote) { border-left: 3px solid theme('colors.gray.600'); padding-left: 1rem; color: theme('colors.gray.400'); margin: 1rem 0; }
  :global(.prose-reader figure) { margin: 1rem 0; }
  :global(.prose-reader figcaption) { color: theme('colors.gray.500'); font-size: 0.8125rem; margin-top: 0.25rem; }
</style>
```

**Step 2: Type-check**

```bash
npm run check
```
Expected: 0 errors.

**Step 3: Commit**

```bash
git add src/lib/components/ArticlePanel.svelte
git commit -m "feat: add ArticlePanel slide-in reader component"
```

---

### Task 5: Add `onselect` prop to ArticleCard

**Files:**
- Modify: `src/lib/components/ArticleCard.svelte`

Change the title `<a>` to intercept click and call `onselect` instead of navigating. Keep `href` for middle-click / right-click to open in tab.

**Step 1: Modify the script block**

Change:
```svelte
let { article }: { article: Article } = $props()
```
To:
```svelte
let { article, onselect }: { article: Article; onselect?: (a: Article) => void } = $props()
```

**Step 2: Modify the title `<a>` tag**

Change:
```svelte
<a
  href={article.url}
  target="_blank"
  rel="noopener noreferrer"
  class="block text-white font-semibold leading-snug hover:text-blue-400 transition-colors mb-1"
>
  {article.title}
</a>
```
To:
```svelte
<a
  href={article.url}
  target="_blank"
  rel="noopener noreferrer"
  class="block text-white font-semibold leading-snug hover:text-blue-400 transition-colors mb-1 cursor-pointer"
  onclick={(e) => { if (onselect) { e.preventDefault(); onselect(article) } }}
>
  {article.title}
</a>
```

**Step 3: Type-check**

```bash
npm run check
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add src/lib/components/ArticleCard.svelte
git commit -m "feat: add onselect callback to ArticleCard"
```

---

### Task 6: Add `onselect` prop to ClusterCard

**Files:**
- Modify: `src/lib/components/ClusterCard.svelte`

Same pattern — intercept headline click, call `onselect` with the representative article.

**Step 1: Modify the script block**

Change:
```svelte
let { cluster }: { cluster: Cluster } = $props()
```
To:
```svelte
import type { Article } from '$lib/types'
let { cluster, onselect }: { cluster: Cluster; onselect?: (a: Article) => void } = $props()
```

**Step 2: Modify the headline `<a>` tag** (line ~54)

Change:
```svelte
<a
  href={rep.url}
  target="_blank"
  rel="noopener noreferrer"
  class="block text-white font-semibold leading-snug hover:text-blue-400 transition-colors mb-1"
>
  {rep.title}
</a>
```
To:
```svelte
<a
  href={rep.url}
  target="_blank"
  rel="noopener noreferrer"
  class="block text-white font-semibold leading-snug hover:text-blue-400 transition-colors mb-1 cursor-pointer"
  onclick={(e) => { if (onselect) { e.preventDefault(); onselect(rep) } }}
>
  {rep.title}
</a>
```

**Step 3: Type-check**

```bash
npm run check
```
Expected: 0 errors.

**Step 4: Commit**

```bash
git add src/lib/components/ClusterCard.svelte
git commit -m "feat: add onselect callback to ClusterCard"
```

---

### Task 7: Wire everything together in +page.svelte

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Add ArticlePanel import**

At the top of the `<script>` block, add:
```svelte
import ArticlePanel from '$lib/components/ArticlePanel.svelte'
import type { Article } from '$lib/types'
```

**Step 2: Add selectedArticle state**

After existing `$state` declarations, add:
```svelte
let selectedArticle = $state<Article | null>(null)
```

**Step 3: Pass onselect to both card types**

Find where `<ArticleCard>` is rendered and add the prop:
```svelte
<ArticleCard article={a} onselect={(a) => selectedArticle = a} />
```

Find where `<ClusterCard>` is rendered and add the prop:
```svelte
<ClusterCard cluster={c} onselect={(a) => selectedArticle = a} />
```

**Step 4: Render the panel**

At the bottom of the template (before the closing tag), add:
```svelte
<ArticlePanel article={selectedArticle} onclose={() => selectedArticle = null} />
```

**Step 5: Type-check and test**

```bash
npm run check && npm test
```
Expected: 0 errors, all tests passing.

**Step 6: Smoke test locally**

```bash
npm run dev
```
Open browser, click any article headline. Panel should slide in from right with shimmer, then article content loads.

**Step 7: Commit and push**

```bash
git add src/routes/+page.svelte
git commit -m "feat: wire article reader panel into main feed"
git push
```

---

### Task 8: Final check

**Step 1: Run full test suite**

```bash
npm run check && npm test
```
Expected: 0 errors, all tests passing.

**Step 2: Verify on prod**

After Vercel deploys: open ww3watch.vercel.app, click a headline. Confirm:
- Panel slides in immediately with shimmer
- Article content loads and replaces shimmer
- Escape key closes panel
- Clicking backdrop closes panel
- "Read original ↗" opens original in new tab
- Middle-click on headline still opens in new tab (href preserved)
