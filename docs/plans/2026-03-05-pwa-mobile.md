# PWA + Mobile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make WW3Watch installable as a PWA with offline article caching and a mobile-friendly slide-up filter sheet.

**Architecture:** `@vite-pwa/sveltekit` generates the service worker via Workbox (generateSW strategy) and injects the web app manifest at build time. A new `FilterSheet` component replaces the sticky `FilterBar` on mobile, opened via a floating action button fixed to the bottom-right. An install prompt banner listens for `beforeinstallprompt` and is dismissible via localStorage.

**Tech Stack:** `@vite-pwa/sveltekit`, `@vite-pwa/assets-generator`, Workbox, Svelte 5 runes, Tailwind v4

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via npm install)

**Step 1: Install PWA packages**

```bash
npm install -D @vite-pwa/sveltekit @vite-pwa/assets-generator
```

Expected: Both appear in `devDependencies` in `package.json`.

**Step 2: Verify existing tests still pass**

```bash
npm run test
```

Expected: All tests pass (cluster, relevance, rss).

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @vite-pwa/sveltekit and assets-generator"
```

---

### Task 2: Generate PWA icons from radar SVG

The source icon is `static/favicon.svg` — the radar design with dark background, concentric rings, sweep line, and red blip.

**Files:**
- Create: `pwa-assets.config.ts` (root, temp — deleted after generation)
- Create: `static/pwa-192x192.png`
- Create: `static/pwa-512x512.png`
- Create: `static/maskable-icon-512x512.png`
- Create: `static/apple-touch-icon-180x180.png`
- Create: `static/favicon-32x32.png`

**Step 1: Create the assets generator config**

Create `pwa-assets.config.ts` at the project root:

```ts
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: minimal2023Preset,
  images: ['static/favicon.svg'],
})
```

**Step 2: Run the generator**

```bash
npx pwa-assets-generator
```

Expected output lists generated files:
```
✓ static/favicon.ico
✓ static/favicon-32x32.png
✓ static/pwa-64x64.png
✓ static/pwa-192x192.png
✓ static/pwa-512x512.png
✓ static/maskable-icon-512x512.png
✓ static/apple-touch-icon-180x180.png
```

**Step 3: Delete the config file** (it was only needed for generation)

```bash
rm pwa-assets.config.ts
```

**Step 4: Commit**

```bash
git add static/
git commit -m "chore: generate PWA icons from radar SVG"
```

---

### Task 3: Configure vite.config.ts with SvelteKitPWA

**Files:**
- Modify: `vite.config.ts`

**Step 1: Replace `vite.config.ts` with this**

```ts
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { SvelteKitPWA } from '@vite-pwa/sveltekit'

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'WW3Watch',
        short_name: 'WW3Watch',
        description: 'Real-time global conflict news aggregator',
        theme_color: '#0a0a0b',
        background_color: '#0a0a0b',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png',        sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png',        sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Cache Supabase REST calls — NetworkFirst so live data shows when online,
            // cached articles shown when offline
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}']
  }
})
```

**Step 2: Verify the build succeeds**

```bash
npm run build
```

Expected: Build completes. A `sw.js` file appears in `.svelte-kit/output/client/`.

**Step 3: Run tests**

```bash
npm run test
```

Expected: All pass.

**Step 4: Commit**

```bash
git add vite.config.ts
git commit -m "feat: add SvelteKitPWA plugin with Workbox caching"
```

---

### Task 4: Update app.html with PWA meta tags

**Files:**
- Modify: `src/app.html`

**Step 1: Replace `src/app.html`**

Key changes: `viewport-fit=cover` for notch support, theme-color, apple PWA meta tags, apple-touch-icon link.

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
		<meta name="theme-color" content="#0a0a0b" />
		<meta name="mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-capable" content="yes" />
		<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
		<meta name="apple-mobile-web-app-title" content="WW3Watch" />
		%sveltekit.head%
		<link rel="icon" type="image/svg+xml" href="%sveltekit.assets%/favicon.svg" />
		<link rel="apple-touch-icon" href="%sveltekit.assets%/apple-touch-icon-180x180.png" />
	</head>
	<body data-sveltekit-preload-data="hover">
		<div style="display: contents">%sveltekit.body%</div>
	</body>
</html>
```

**Step 2: Commit**

```bash
git add src/app.html
git commit -m "feat: add PWA and apple mobile meta tags"
```

---

### Task 5: Register service worker in +layout.svelte

`virtual:pwa-register` must be imported dynamically (not statically) because SvelteKit renders the layout on the server where the virtual module doesn't exist.

**Files:**
- Modify: `src/routes/+layout.svelte`

**Step 1: Update `src/routes/+layout.svelte`**

```svelte
<script>
  import '../app.css'
  import favicon from '$lib/assets/favicon.svg'
  import { onMount } from 'svelte'

  let { children } = $props()

  onMount(async () => {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  })
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
```

**Step 2: Verify build still works**

```bash
npm run build
```

Expected: No TypeScript errors. Build succeeds.

**Step 3: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat: register PWA service worker in layout"
```

---

### Task 6: Create FilterSheet component

New slide-up bottom sheet for mobile. Contains the same search + region filter controls as FilterBar, bound to the same state via props.

**Files:**
- Create: `src/lib/components/FilterSheet.svelte`

**Step 1: Create `src/lib/components/FilterSheet.svelte`**

```svelte
<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { REGION_COLORS, ALL_REGIONS } from '$lib/types'

  let {
    open = $bindable(),
    activeRegions = $bindable(),
    searchQuery = $bindable(),
  }: {
    open: boolean
    activeRegions: Set<SourceRegion>
    searchQuery: string
  } = $props()

  function toggleRegion(region: SourceRegion) {
    const next = new Set(activeRegions)
    if (next.has(region)) next.delete(region)
    else next.add(region)
    activeRegions = next
  }

  function selectAll() { activeRegions = new Set(ALL_REGIONS) }
  function clearAll() { activeRegions = new Set() }
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/60 z-40 md:hidden"
    onclick={() => open = false}
    role="presentation"
  ></div>

  <!-- Sheet -->
  <div
    class="fixed bottom-0 left-0 right-0 z-50 bg-[#111113] rounded-t-2xl border-t border-gray-800 md:hidden"
    style="padding-bottom: env(safe-area-inset-bottom, 0px)"
  >
    <!-- Drag handle -->
    <div class="flex justify-center pt-3 pb-1">
      <div class="w-10 h-1 rounded-full bg-gray-700"></div>
    </div>

    <div class="px-4 pt-2 pb-5 space-y-3">
      <!-- Search + All/None -->
      <div class="flex items-center gap-2">
        <input
          type="text"
          placeholder="Search headlines..."
          bind:value={searchQuery}
          class="flex-1 bg-[#18181b] border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button onclick={selectAll} class="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors">All</button>
        <button onclick={clearAll} class="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors">None</button>
      </div>

      <!-- Region toggles -->
      <div class="flex flex-wrap gap-1.5">
        {#each ALL_REGIONS as region}
          <button
            onclick={() => toggleRegion(region)}
            class="text-xs px-2 py-1 rounded font-medium transition-opacity cursor-pointer {REGION_COLORS[region]} {activeRegions.has(region) ? 'opacity-100' : 'opacity-30'}"
          >
            {region}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}
```

**Step 2: Run tests**

```bash
npm run test
```

Expected: All pass (no test changes needed for this component).

**Step 3: Commit**

```bash
git add src/lib/components/FilterSheet.svelte
git commit -m "feat: add FilterSheet slide-up component for mobile"
```

---

### Task 7: Hide FilterBar on mobile

**Files:**
- Modify: `src/lib/components/FilterBar.svelte:27`

**Step 1: Add `hidden md:flex` to the outer div**

The outer div currently is:
```svelte
<div class="sticky top-0 z-10 bg-[#0a0a0b]/95 backdrop-blur border-b border-gray-800 px-4 py-3">
```

Change to:
```svelte
<div class="sticky top-0 z-10 bg-[#0a0a0b]/95 backdrop-blur border-b border-gray-800 px-4 py-3 hidden md:block">
```

**Step 2: Commit**

```bash
git add src/lib/components/FilterBar.svelte
git commit -m "feat: hide FilterBar on mobile (replaced by FilterSheet)"
```

---

### Task 8: Update +page.svelte — FAB, FilterSheet, install prompt, safe area

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Replace `src/routes/+page.svelte` with this**

```svelte
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { supabase } from '$lib/supabase'
  import type { Article, SourceRegion } from '$lib/types'
  import { ALL_REGIONS } from '$lib/types'
  import ArticleCard from '$lib/components/ArticleCard.svelte'
  import ClusterCard from '$lib/components/ClusterCard.svelte'
  import TopStories from '$lib/components/TopStories.svelte'
  import FilterBar from '$lib/components/FilterBar.svelte'
  import FilterSheet from '$lib/components/FilterSheet.svelte'
  import ArticlePanel from '$lib/components/ArticlePanel.svelte'
  import { groupByClusterId } from '$lib/cluster'
  import type { Cluster } from '$lib/cluster'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  let articles = $state<Article[]>(untrack(() => (data.articles as Article[]) ?? []))
  let newQueue = $state<Article[]>([])
  let scrollY = $state(0)
  let searchQuery = $state('')
  let activeRegions = $state(new Set<SourceRegion>(ALL_REGIONS))
  let clusterMode = $state(true)
  let selectedArticle = $state<Article | null>(null)
  let filterSheetOpen = $state(false)

  // Install prompt
  let installPromptEvent = $state<BeforeInstallPromptEvent | null>(null)
  let installDismissed = $state(false)

  // Two separate cluster passes: allClustered uses the full article list (global top stories),
  // clustered uses the filtered list (feed view). They cannot be shared.
  const TOP_STORIES_WINDOW_MS = 60 * 60 * 1000

  let isPaused = $derived(scrollY > 300)

  let filtered = $derived(
    articles.filter(a => {
      const matchesRegion = activeRegions.has(a.source_region)
      const q = searchQuery.trim().toLowerCase()
      const matchesSearch = q === '' ||
        a.title.toLowerCase().includes(q) ||
        (a.summary ?? '').toLowerCase().includes(q)
      return matchesRegion && matchesSearch
    })
  )
  let clustered = $derived(groupByClusterId(filtered))
  let allClustered = $derived(groupByClusterId(articles))
  let trendingIds = $derived((data.trendingIds ?? []) as string[])
  let topStories = $derived(
    trendingIds.length > 0
      ? trendingIds
          .map(id => allClustered.find(c => c.representative.id === id))
          .filter((c): c is Cluster => c !== undefined)
      : allClustered
          .filter(c =>
            c.representative.published_at
              ? Date.now() - new Date(c.representative.published_at).getTime() < TOP_STORIES_WINDOW_MS
              : false
          )
          .sort((a, b) => b.sourceCount - a.sourceCount)
          .slice(0, 3)
  )

  function flushQueue() {
    articles = [...newQueue, ...articles]
    newQueue = []
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleInstall() {
    if (!installPromptEvent) return
    installPromptEvent.prompt()
    installPromptEvent = null
  }

  function dismissInstall() {
    installDismissed = true
    localStorage.setItem('pwa-install-dismissed', '1')
  }

  onMount(() => {
    // Restore install-dismissed preference
    if (localStorage.getItem('pwa-install-dismissed')) {
      installDismissed = true
    }

    // Capture the install prompt for later use
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      installPromptEvent = e as BeforeInstallPromptEvent
    })

    const channel = supabase
      .channel('articles-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'articles' },
        (payload) => {
          const article = payload.new as Article
          if (isPaused) {
            newQueue = [article, ...newQueue]
          } else {
            articles = [article, ...articles]
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  })
</script>

<svelte:window bind:scrollY />

<div class="min-h-screen bg-[#0a0a0b]">
  <!-- Header — pt accounts for iOS notch via viewport-fit=cover -->
  <header
    class="border-b border-gray-800 px-4 py-3 bg-[#0a0a0b]"
    style="padding-top: calc(0.75rem + env(safe-area-inset-top, 0px))"
  >
    <div class="max-w-3xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-white font-bold text-lg tracking-tight">WW3Watch</h1>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          <span class="text-xs text-gray-400 uppercase tracking-wider">Live</span>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-500">
          {clusterMode
            ? `${clustered.length.toLocaleString()} stories`
            : `${filtered.length.toLocaleString()} articles`}
        </span>
        <button
          onclick={() => clusterMode = !clusterMode}
          class="text-xs px-2 py-1 rounded border transition-colors {clusterMode
            ? 'border-blue-500 text-blue-400 bg-blue-500/10'
            : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'}"
        >
          Cluster
        </button>
        <a
          href="https://github.com/noahsabaj/ww3watch"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository"
          class="text-gray-600 hover:text-gray-300 transition-colors"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.5 11.5 0 0 1 12 6.803c.98.005 1.967.138 2.888.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
          </svg>
        </a>
      </div>
    </div>
  </header>

  <!-- Install prompt banner (mobile only, dismissible) -->
  {#if installPromptEvent && !installDismissed}
    <div class="md:hidden bg-blue-950/80 border-b border-blue-900 px-4 py-2 flex items-center gap-3">
      <span class="text-sm text-blue-200 flex-1">Add WW3Watch to your home screen</span>
      <button
        onclick={handleInstall}
        class="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded font-medium transition-colors shrink-0"
      >
        Install
      </button>
      <button
        onclick={dismissInstall}
        class="text-gray-400 hover:text-gray-200 transition-colors text-lg leading-none shrink-0"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  {/if}

  <!-- Trending Now -->
  <TopStories stories={topStories} />

  <!-- Filter Bar (desktop only — mobile uses FilterSheet via FAB) -->
  <FilterBar bind:activeRegions bind:searchQuery />

  <!-- New articles banner -->
  {#if newQueue.length > 0 && isPaused}
    <div class="fixed top-[120px] left-1/2 -translate-x-1/2 z-20">
      <button
        onclick={flushQueue}
        class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow-lg transition-colors"
      >
        ↑ {newQueue.length} new {newQueue.length === 1 ? 'article' : 'articles'}
      </button>
    </div>
  {/if}

  <!-- Feed -->
  <main
    class="max-w-3xl mx-auto divide-y divide-gray-800/50"
    style="padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0px))"
  >
    {#if filtered.length === 0}
      <div class="py-20 text-center text-gray-500 text-sm">
        {articles.length === 0 ? 'Loading articles...' : 'No articles match your filters.'}
      </div>
    {:else if clusterMode}
      {#each clustered as cluster (cluster.id)}
        <ClusterCard {cluster} onselect={(a) => selectedArticle = a} />
      {/each}
    {:else}
      {#each filtered as article (article.id)}
        <ArticleCard {article} onselect={(a) => selectedArticle = a} />
      {/each}
    {/if}
  </main>

  <!-- Mobile FAB: opens FilterSheet -->
  <button
    class="fixed right-4 z-30 md:hidden w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-colors"
    style="bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px))"
    onclick={() => filterSheetOpen = true}
    aria-label="Open filters"
  >
    <!-- Filter/sliders icon -->
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="4" y1="6" x2="20" y2="6"/>
      <line x1="4" y1="12" x2="16" y2="12"/>
      <line x1="4" y1="18" x2="12" y2="18"/>
    </svg>
  </button>

  <!-- Mobile filter sheet -->
  <FilterSheet bind:open={filterSheetOpen} bind:activeRegions bind:searchQuery />

  <ArticlePanel article={selectedArticle} onclose={() => selectedArticle = null} />
</div>
```

Note: `BeforeInstallPromptEvent` is not in standard TypeScript lib. Add a declaration to `src/app.d.ts`.

**Step 2: Add `BeforeInstallPromptEvent` type to `src/app.d.ts`**

The file currently declares the SvelteKit namespace. Append this interface:

```ts
// src/app.d.ts — add after existing content:
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
```

**Step 3: Run tests**

```bash
npm run test
```

Expected: All pass.

**Step 4: Commit**

```bash
git add src/routes/+page.svelte src/app.d.ts
git commit -m "feat: add FAB, FilterSheet, install prompt and safe-area padding"
```

---

### Task 9: Final build verification and push

**Step 1: Full build**

```bash
npm run build
```

Expected: Clean build, no TypeScript errors, `sw.js` present in output.

**Step 2: Run all tests**

```bash
npm run test
```

Expected: All pass.

**Step 3: Push to trigger Vercel deployment**

```bash
git push
```

---

### Manual verification checklist (after deploy)

- [ ] Open ww3watch.vercel.app on Android Chrome — "Add to Home Screen" prompt appears
- [ ] Install the app — opens in standalone mode (no browser chrome)
- [ ] Open app, load articles, then enable airplane mode — cached articles still visible
- [ ] On mobile: FAB appears bottom-right, tapping opens slide-up filter sheet
- [ ] FilterBar is hidden on mobile, visible on desktop (≥768px)
- [ ] Install banner appears on first mobile visit, dismisses and doesn't reappear
- [ ] iOS Safari: apple-touch-icon appears when added to home screen
- [ ] Header notch padding correct on iPhone (no content behind status bar)
