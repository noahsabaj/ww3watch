<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import type { Article, SourceRegion } from '$lib/types'
  import ArticleCard from '$lib/components/ArticleCard.svelte'
  import FilterBar from '$lib/components/FilterBar.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  const ALL_REGIONS: SourceRegion[] = [
    'US/Western', 'UK', 'European', 'Israeli',
    'Iranian State', 'Iranian Independent', 'Iranian Local',
    'Arab/Gulf', 'Kurdish', 'Turkish',
    'Russian', 'Chinese', 'South Asian', 'Independent/OSINT',
  ]

  let articles = $state<Article[]>((data.articles ?? []) as Article[])
  let newQueue = $state<Article[]>([])
  let scrollY = $state(0)
  let searchQuery = $state('')
  let activeRegions = $state(new Set<SourceRegion>(ALL_REGIONS))

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
      <span class="text-xs text-gray-500">{filtered.length.toLocaleString()} articles</span>
    </div>
  </header>

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
    {/if}

    {#each filtered as article (article.id)}
      <ArticleCard {article} />
    {/each}
  </main>
</div>
