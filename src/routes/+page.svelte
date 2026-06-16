<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { supabase } from '$lib/supabase'
  import type { Article, SourceRegion } from '$lib/types'
  import { ALL_REGIONS } from '$lib/types'
  import Header from '$lib/components/Header.svelte'
  import ClusterCard from '$lib/components/ClusterCard.svelte'
  import TopStories from '$lib/components/TopStories.svelte'
  import FilterSheet from '$lib/components/FilterSheet.svelte'
  import ArticlePanel from '$lib/components/ArticlePanel.svelte'
  import { groupByStoryId } from '$lib/cluster'
  import { dayKey, dayLabel } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import type { Cluster } from '$lib/cluster'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  let articles = $state<Article[]>(untrack(() => (data.articles as Article[]) ?? []))
  let newQueue = $state<Article[]>([])
  // Live trending selection: seeded from the load, refreshed via realtime
  // events on the trending table (the pipeline rewrites it each run).
  type TrendingRef = { article_id: string; story_id: string | null }
  let trending = $state<TrendingRef[]>(untrack(() => (data.trending as TrendingRef[]) ?? []))
  // Last successful ingestion run — the "updated Xm ago" readout. Anchor only
  // changes when a run completes; the label itself ticks via clock.now.
  let lastUpdatedAt = $state<string | null>(untrack(() => (data.lastUpdatedAt as string | null) ?? null))
  let scrollY = $state(0)
  let searchQuery = $state('')
  let activeRegions = $state(new Set<SourceRegion>(ALL_REGIONS))
  let selectedArticle = $state<Article | null>(null)
  // allClustered uses the full (unfiltered) article list — see note below.
  let allClustered = $derived(groupByStoryId(articles))
  let selectedCluster = $derived(
    selectedArticle
      ? allClustered.find(c => c.articles.some(a => a.id === selectedArticle!.id)) ?? null
      : null
  )
  let filterSheetOpen = $state(false)
  let filterDropdownOpen = $state(false)
  let realtimeStatus = $state('CLOSED')
  let isFiltered = $derived(searchQuery.trim() !== '' || activeRegions.size < ALL_REGIONS.length)

  // Dead-man's switch tiers: pipeline real cadence is 30–120 min, so >3h means
  // several missed runs; >24h means it's down.
  const STALE_AMBER_MS = 3 * 60 * 60 * 1000
  const STALE_RED_MS = 24 * 60 * 60 * 1000
  let staleness = $derived.by((): 'ok' | 'amber' | 'red' | null => {
    if (!lastUpdatedAt) return null
    const age = clock.now - Date.parse(lastUpdatedAt)
    return age > STALE_RED_MS ? 'red' : age > STALE_AMBER_MS ? 'amber' : 'ok'
  })

  // Install prompt
  let installPromptEvent = $state<BeforeInstallPromptEvent | null>(null)
  let installDismissed = $state(false)

  // Two separate cluster passes: allClustered uses the full article list (global top stories),
  // clustered uses the filtered list (feed view). They cannot be shared.
  const TOP_STORIES_WINDOW_MS = 60 * 60 * 1000
  // Cap in-memory list growth on long-lived tabs (realtime keeps prepending).
  const MAX_ARTICLES = 800

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
  let clustered = $derived(groupByStoryId(filtered))
  let topStories = $derived.by(() => {
    if (trending.length > 0) {
      // Resolve by story_id when the row has one; fall back to membership
      // lookup for legacy rows written before stories existed. Dedupe in case
      // two picks land in the same cluster.
      const seen = new Set<string>()
      const result: Cluster[] = []
      for (const t of trending) {
        const c =
          (t.story_id ? allClustered.find(cl => cl.storyId === t.story_id) : undefined) ??
          allClustered.find(cl => cl.articles.some(a => a.id === t.article_id))
        if (c && !seen.has(c.id)) {
          seen.add(c.id)
          result.push(c)
        }
      }
      return result
    }
    return allClustered
      .filter(c =>
        c.representative.published_at
          ? Date.now() - new Date(c.representative.published_at).getTime() < TOP_STORIES_WINDOW_MS
          : false
      )
      .sort((a, b) => b.sourceCount - a.sourceCount)
      .slice(0, 3)
  })

  // The pipeline rewrites trending as a burst (≤3 DELETEs + 3 INSERTs) —
  // debounce to one refetch, and never interpret event payloads (DELETE
  // delivery semantics under RLS differ; any event is just a refetch signal).
  let trendingRefreshTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleTrendingRefresh() {
    clearTimeout(trendingRefreshTimer)
    trendingRefreshTimer = setTimeout(async () => {
      const { data: rows, error } = await supabase
        .from('trending')
        .select('article_id, rank, story_id')
        .order('rank', { ascending: true })
      // On error keep the previous selection.
      if (!error && rows) trending = rows.map((t) => ({ article_id: t.article_id, story_id: t.story_id ?? null }))
    }, 2500)
  }

  // Realtime article/trending events mean a pipeline run just wrote — refresh
  // the freshness anchor once the burst settles. Quiet runs that change
  // nothing leave the readout conservatively stale, which is fine.
  let statusRefreshTimer: ReturnType<typeof setTimeout> | undefined
  function schedulePipelineStatusRefresh() {
    clearTimeout(statusRefreshTimer)
    statusRefreshTimer = setTimeout(async () => {
      const { data: ts, error } = await supabase.rpc('pipeline_status')
      if (!error && ts) lastUpdatedAt = ts as string
    }, 5000)
  }

  // Realtime burst batching: the pipeline writes a burst of inserts +
  // cluster-assignment updates every ~15 min. Accumulate raw events in
  // non-reactive buffers and apply them in ONE state reassignment per ~500ms
  // window, instead of a full derived-graph recompute per event.
  let pendingInserts: Article[] = []
  let pendingUpdates = new Map<string, Article>()
  let realtimeFlushTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleRealtimeFlush() {
    clearTimeout(realtimeFlushTimer)
    realtimeFlushTimer = setTimeout(applyRealtime, 500)
  }
  function applyRealtime() {
    if (pendingInserts.length > 0) {
      const incoming = pendingInserts
      pendingInserts = []
      // Dedupe against current lists (realtime replays on reconnect) + within batch.
      const known = new Set<string>([...articles, ...newQueue].map((a) => a.id))
      const fresh: Article[] = []
      for (const a of incoming) if (!known.has(a.id)) { known.add(a.id); fresh.push(a) }
      if (fresh.length > 0) {
        // isPaused (scrollY>300) read at flush time, so a mid-burst scroll wins.
        if (isPaused) newQueue = [...fresh, ...newQueue]
        else articles = [...fresh, ...articles].slice(0, MAX_ARTICLES)
      }
    }
    if (pendingUpdates.size > 0) {
      const updates = pendingUpdates
      pendingUpdates = new Map()
      // Patch in whichever list holds each id; unknown ids no-op.
      articles = articles.map((a) => updates.get(a.id) ?? a)
      newQueue = newQueue.map((a) => updates.get(a.id) ?? a)
    }
  }

  function flushQueue() {
    articles = [...newQueue, ...articles].slice(0, MAX_ARTICLES)
    newQueue = []
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
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

    // Deep link: ?article=<id> opens that article in the reader
    const params = new URLSearchParams(window.location.search)
    const articleId = params.get('article')
    if (articleId) {
      const target = articles.find(a => a.id === articleId)
      if (target) selectedArticle = target
      history.replaceState({}, '', window.location.pathname)
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
          pendingInserts.push(payload.new as Article)
          schedulePipelineStatusRefresh()
          scheduleRealtimeFlush()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trending' },
        () => {
          scheduleTrendingRefresh()
          // Trending rewrites even on zero-new-article runs — the best signal
          // that an ingestion run just completed.
          schedulePipelineStatusRefresh()
        },
      )
      // supabase-js auto-rejoins with backoff after TIMED_OUT/CHANNEL_ERROR and
      // re-fires SUBSCRIBED — the header dot just mirrors the latest status.
      .subscribe((status) => {
        realtimeStatus = status
      })

    // UPDATE on its OWN channel with a server-side filter: cluster-assignment
    // patches arrive minutes after the INSERT (recent fetched_at), so we only
    // need recent rows — this stops every backlog UPDATE fanning out to every
    // client (egress + radio wakeups). A SEPARATE channel means a filter
    // rejection degrades only cluster-patching, never the INSERT/trending feed.
    const recentCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const updatesChannel = supabase
      .channel('articles-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'articles', filter: `fetched_at=gt.${recentCutoff}` },
        (payload) => {
          pendingUpdates.set((payload.new as Article).id, payload.new as Article)
          scheduleRealtimeFlush()
        },
      )
      .subscribe((status) => {
        // Only cluster-patching depends on this channel; if its filter is ever
        // rejected, log it (the main feed is unaffected) rather than failing silently.
        if (status === 'CHANNEL_ERROR') console.warn('[realtime] articles-updates channel error — live cluster regrouping degraded')
      })

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      clearTimeout(trendingRefreshTimer)
      clearTimeout(statusRefreshTimer)
      clearTimeout(realtimeFlushTimer)
      supabase.removeChannel(channel)
      supabase.removeChannel(updatesChannel)
    }
  })
</script>

<svelte:window bind:scrollY />

<div class="min-h-screen bg-[#0a0a0b]">
  <Header
    bind:searchQuery
    bind:activeRegions
    bind:filterDropdownOpen
    storyCount={clustered.length}
    totalCount={Math.max(allClustered.length, clustered.length)}
    {isFiltered}
    {realtimeStatus}
    {lastUpdatedAt}
    {staleness}
  />

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
    <!-- 4rem clears the sticky header (~59px on md+ where the search input sets row height) -->
    <div class="fixed left-1/2 -translate-x-1/2 z-20" style="top: calc(4rem + env(safe-area-inset-top, 0px))">
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
        {#if data.loadError && articles.length === 0}
          <p class="mb-3">Couldn't load the feed.</p>
          <button
            onclick={() => location.reload()}
            class="text-blue-400 hover:text-blue-300 border border-gray-700 hover:border-gray-500 rounded px-3 py-1.5 transition-colors"
          >
            Retry
          </button>
        {:else if articles.length === 0}
          No stories yet — new ones appear here live.
        {:else}
          No articles match your filters.
        {/if}
      </div>
    {:else}
      {#each clustered as cluster, i (cluster.id)}
        <!-- Day separator at each calendar-day boundary — safe because
             groupByClusterId sorts by representative published_at DESC. -->
        {#if i === 0 || dayKey(cluster.representative.published_at, clock.now) !== dayKey(clustered[i - 1].representative.published_at, clock.now)}
          <div class="px-4 py-1.5 text-[10px] uppercase tracking-widest text-gray-600">
            {dayLabel(cluster.representative.published_at, clock.now)}
          </div>
        {/if}
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

  <ArticlePanel article={selectedArticle} cluster={selectedCluster} onclose={() => selectedArticle = null} onselect={(a) => selectedArticle = a} />
</div>
