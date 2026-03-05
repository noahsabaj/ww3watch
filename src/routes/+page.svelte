<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { supabase } from '$lib/supabase'
  import type { Article, SourceRegion } from '$lib/types'
  import { ALL_REGIONS, REGION_COLORS } from '$lib/types'
  import ClusterCard from '$lib/components/ClusterCard.svelte'
  import TopStories from '$lib/components/TopStories.svelte'
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
  let selectedArticle = $state<Article | null>(null)
  let filterSheetOpen = $state(false)
  let filterDropdownOpen = $state(false)

  function toggleRegion(region: SourceRegion) {
    const next = new Set(activeRegions)
    if (next.has(region)) next.delete(region)
    else next.add(region)
    activeRegions = next
  }
  function selectAll() { activeRegions = new Set(ALL_REGIONS) }
  function clearAll() { activeRegions = new Set() }

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
  let topStories = $derived.by(() => {
    const trendingIds = (data.trendingIds ?? []) as string[]
    return trendingIds.length > 0
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
  })

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
    if (localStorage.getItem('pwa-install-dismissed')) {
      installDismissed = true
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      installPromptEvent = e as BeforeInstallPromptEvent
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

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

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      supabase.removeChannel(channel)
    }
  })
</script>

<svelte:window bind:scrollY />

<div class="min-h-screen bg-[#0a0a0b]">
  <!-- Header — padding-top accounts for iOS notch via viewport-fit=cover -->
  <header
    class="border-b border-gray-800 px-4 py-3 bg-[#0a0a0b]"
    style="padding-top: calc(0.75rem + env(safe-area-inset-top, 0px))"
  >
    <div class="max-w-3xl mx-auto flex items-center gap-3">
      <!-- Brand -->
      <div class="flex items-center gap-3 shrink-0">
        <h1 class="text-white font-bold text-lg tracking-tight">WW3Watch</h1>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          <span class="text-xs text-gray-400 uppercase tracking-wider">Live</span>
        </div>
      </div>

      <!-- Search input (desktop only) -->
      <input
        type="text"
        placeholder="Search headlines..."
        bind:value={searchQuery}
        class="hidden md:block flex-1 min-w-0 bg-[#18181b] border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />

      <!-- Right actions -->
      <div class="flex items-center gap-2 ml-auto md:ml-0 shrink-0">
        <span class="text-xs text-gray-500">{clustered.length.toLocaleString()} stories</span>

        <!-- Region filter button + dropdown (desktop only) -->
        <div class="relative hidden md:block">
          <button
            onclick={() => filterDropdownOpen = !filterDropdownOpen}
            aria-label="Filter by region"
            class="flex items-center justify-center w-7 h-7 rounded transition-colors {filterDropdownOpen || activeRegions.size < ALL_REGIONS.length ? 'text-blue-400' : 'text-gray-600 hover:text-gray-300'}"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
              <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none"/>
            </svg>
          </button>

          {#if filterDropdownOpen}
            <div class="fixed inset-0 z-40" onclick={() => filterDropdownOpen = false} role="presentation"></div>
            <div class="absolute right-0 top-full mt-2 z-50 bg-[#111113] border border-gray-700 rounded-lg p-3 w-80 shadow-xl">
              <div class="flex items-center justify-between mb-2.5">
                <span class="text-[10px] text-gray-600 uppercase tracking-widest">Regions</span>
                <div class="flex gap-1">
                  <button onclick={selectAll} class="text-xs text-gray-400 hover:text-white px-2 py-0.5 transition-colors">All</button>
                  <button onclick={clearAll} class="text-xs text-gray-400 hover:text-white px-2 py-0.5 transition-colors">None</button>
                </div>
              </div>
              <div class="flex flex-wrap gap-1.5">
                {#each ALL_REGIONS as region}
                  <button
                    onclick={() => toggleRegion(region)}
                    class="text-xs px-2 py-0.5 rounded font-medium transition-opacity cursor-pointer {REGION_COLORS[region]} {activeRegions.has(region) ? 'opacity-100' : 'opacity-30'}"
                  >
                    {region}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

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
  <TopStories stories={topStories} onselect={(a) => selectedArticle = a} />

  <!-- New articles banner -->
  {#if newQueue.length > 0 && isPaused}
    <div class="fixed left-1/2 -translate-x-1/2 z-20" style="top: calc(3.5rem + env(safe-area-inset-top, 0px))">
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
    {#if clustered.length === 0}
      <div class="py-20 text-center text-gray-500 text-sm">
        {articles.length === 0 ? 'Loading articles...' : 'No articles match your filters.'}
      </div>
    {:else}
      {#each clustered as cluster (cluster.id)}
        <ClusterCard {cluster} onselect={(a) => selectedArticle = a} />
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
