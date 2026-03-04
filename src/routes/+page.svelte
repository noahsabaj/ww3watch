<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { supabase } from '$lib/supabase'
  import type { Article, SourceRegion } from '$lib/types'
  import { ALL_REGIONS } from '$lib/types'
  import ArticleCard from '$lib/components/ArticleCard.svelte'
  import ClusterCard from '$lib/components/ClusterCard.svelte'
  import TopStories from '$lib/components/TopStories.svelte'
  import FilterBar from '$lib/components/FilterBar.svelte'
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

  onMount(() => {
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
  <!-- Header -->
  <header class="border-b border-gray-800 px-4 py-3 bg-[#0a0a0b]">
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

  <!-- Trending Now -->
  <TopStories stories={topStories} />

  <!-- Filter Bar -->
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
  <main class="max-w-3xl mx-auto divide-y divide-gray-800/50 pb-20">
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

  <ArticlePanel article={selectedArticle} onclose={() => selectedArticle = null} />
</div>
