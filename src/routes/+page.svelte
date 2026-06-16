<script lang="ts">
  import { onMount, untrack, tick } from 'svelte'
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

  // Index of the first cluster older than the last visit. The feed is DESC, so
  // this is the boundary between "new since you were here" (above) and "seen
  // before" (below). -1 = no marker (first visit, or nothing new, or all new).
  let lastVisitDividerIndex = $derived.by(() => {
    if (lastVisitAt === null) return -1
    const t = (c: Cluster) => (c.representative.published_at ? Date.parse(c.representative.published_at) : 0)
    for (let i = 1; i < clustered.length; i++) {
      if (t(clustered[i - 1]) > lastVisitAt && t(clustered[i]) <= lastVisitAt) return i
    }
    return -1
  })

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
  // Hard ceiling once the user has paged back (articleCap grows with each "Load
  // older" so a realtime prepend can't slice off loaded rows — but it must stop
  // growing somewhere, or a paged-back long-lived tab loses the MAX_ARTICLES
  // protection entirely). Beyond this, the next realtime flush trims the oldest.
  const MAX_LOADED = 2400

  // Server column list — MUST match +page.ts so realtime/pagination rows are
  // shape-identical to the initial load.
  const FEED_COLUMNS = 'id,title,url,summary,published_at,fetched_at,source_name,source_region,source_lang,source_affiliation,story_id,body_hash'
  const INITIAL_LIMIT = 500 // keep in sync with +page.ts .limit()
  const PAGE_SIZE = 100

  // Pagination ("Load older"): numeric offset against the same DESC ordering.
  // serverOffset counts rows pulled from the server (independent of realtime
  // prepends); articleCap lets the realtime slice-cap grow as the user pages back,
  // so a live insert never discards manually-loaded older stories.
  // Note: realtime INSERTs land at the TOP of the DESC window, so rows added
  // server-side after load shift everything to a higher absolute offset and the
  // next range() re-reads a few already-held rows. Those are deduped client-side
  // (the `known` Set) — correct, just a little redundant egress on a tab left open
  // across pipeline runs. Offset is chosen over a keyset cursor precisely because
  // it never SKIPS a row (the dedup makes overlap harmless) and handles the
  // null-published tail without a separate query.
  let serverOffset = $state(untrack(() => ((data.articles as Article[]) ?? []).length))
  let hasMore = $state(untrack(() => ((data.articles as Article[]) ?? []).length >= INITIAL_LIMIT))
  let loadingMore = $state(false)
  let articleCap = $state(MAX_ARTICLES)
  // Pre-existing polite live region (announced to screen readers). Focus for the
  // "Load older" button (re-rendering the feed blurs it) and the end marker it's
  // replaced by on the final page is restored by id, after the DOM settles.
  let liveMessage = $state('')

  // Toast for deep-link recovery + pagination errors.
  let toast = $state<string | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  function showToast(msg: string) {
    toast = msg
    liveMessage = msg // announce via the persistent live region (the visual pill is sighted-only)
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast = null), 4500)
  }

  // "New since your last visit" marker, frozen at mount so realtime prepends
  // don't move the line. localStorage is rewritten to now on each visit.
  let lastVisitAt = $state<number | null>(null)

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
        else articles = [...fresh, ...articles].slice(0, articleCap)
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
    articles = [...newQueue, ...articles].slice(0, articleCap)
    newQueue = []
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  function clearFilters() {
    searchQuery = ''
    activeRegions = new Set(ALL_REGIONS)
  }

  // "Load older": pull the next page from the server (offset against the same
  // DESC order), append the rows not already held. Appending older rows keeps
  // the list DESC; groupByStoryId re-sorts regardless. articleCap grows so a
  // realtime prepend won't slice off what we just loaded.
  async function loadOlder() {
    if (loadingMore || !hasMore) return
    // The large list re-render below blurs the focused control; if the user
    // drove this from the keyboard, restore focus afterward (mouse users are
    // left alone — :focus-visible keeps the ring keyboard-only anyway).
    const hadFocus = document.activeElement?.id === 'feed-load-older'
    loadingMore = true
    const { data: rows, error } = await supabase
      .from('articles')
      .select(FEED_COLUMNS)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('fetched_at', { ascending: false })
      .range(serverOffset, serverOffset + PAGE_SIZE - 1)
    loadingMore = false
    if (error) {
      showToast("Couldn't load older stories.")
      return
    }
    serverOffset += PAGE_SIZE
    const incoming = (rows ?? []) as Article[]
    if (incoming.length < PAGE_SIZE) hasMore = false
    const known = new Set(articles.map((a) => a.id))
    const fresh = incoming.filter((a) => !known.has(a.id))
    if (fresh.length > 0) {
      // Grow the realtime slice-cap to fit, but never past MAX_LOADED — beyond
      // that the next realtime flush trims the oldest, keeping memory bounded.
      articleCap = Math.min(articleCap + fresh.length, MAX_LOADED)
      articles = [...articles, ...fresh]
    }
    // Announce the result to screen readers; the button fires no visible state
    // on success on its own.
    const noun = fresh.length === 1 ? 'story' : 'stories'
    liveMessage = fresh.length > 0 ? `Loaded ${fresh.length} older ${noun}.` : 'No new older stories.'
    if (!hasMore) liveMessage += " You've reached the oldest stories."
    // Restore focus to the button (or the end marker, once the button unmounts
    // on the final page) so a keyboard user isn't dropped to <body>. tick() flushes
    // the append render; rAF then runs after the browser settles that layout, so
    // focus lands on the live element rather than a torn-down one.
    if (hadFocus) {
      await tick()
      requestAnimationFrame(() => {
        document.getElementById(hasMore ? 'feed-load-older' : 'feed-end')?.focus()
      })
    }
  }

  // Deep-link recovery: open ?article=/?story= even when the target scrolled
  // past the initial window — fetch the missing row(s) on demand.
  async function recoverDeepLink(articleId: string | null, storyId: string | null) {
    if (articleId) {
      const local = articles.find((a) => a.id === articleId)
      if (local) { selectedArticle = local; return }
      const { data: row, error } = await supabase
        .from('articles').select(FEED_COLUMNS).eq('id', articleId).maybeSingle()
      if (error || !row) { showToast('That article is no longer in the feed.'); return }
      const a = row as Article
      if (!articles.some((x) => x.id === a.id)) articles = [a, ...articles]
      selectedArticle = a
      return
    }
    if (storyId) {
      const local = allClustered.find((c) => c.storyId === storyId)
      if (local) { selectedArticle = local.representative; return }
      const { data: rows, error } = await supabase
        .from('articles').select(FEED_COLUMNS).eq('story_id', storyId)
        .order('published_at', { ascending: false, nullsFirst: false }).limit(100)
      const list = (rows ?? []) as Article[]
      if (error || list.length === 0) { showToast('That story is no longer in the feed.'); return }
      const known = new Set(articles.map((a) => a.id))
      const fresh = list.filter((a) => !known.has(a.id))
      if (fresh.length > 0) articles = [...articles, ...fresh]
      // Newest member is the representative (matches groupByStoryId).
      selectedArticle = list.reduce((best, a) =>
        ((a.published_at ?? '') > (best.published_at ?? '') ? a : best), list[0])
    }
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

    // "New since your last visit" marker: read the previous visit, then stamp now.
    const prevVisit = Number(localStorage.getItem('ww3-last-visit'))
    lastVisitAt = Number.isFinite(prevVisit) && prevVisit > 0 ? prevVisit : null
    localStorage.setItem('ww3-last-visit', String(Date.now()))

    // Deep link: ?article=<id> opens that article; ?story=<id> opens that story.
    // Both recover targets that scrolled past the initial window.
    const params = new URLSearchParams(window.location.search)
    const articleId = params.get('article')
    const storyId = params.get('story')
    if (articleId || storyId) {
      recoverDeepLink(articleId, storyId)
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
      clearTimeout(toastTimer)
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
          <p class="mb-3">No stories match your filters.</p>
          <button
            onclick={clearFilters}
            class="text-blue-400 hover:text-blue-300 border border-gray-700 hover:border-gray-500 rounded px-3 py-1.5 transition-colors"
          >
            Clear filters
          </button>
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
        <!-- "New since your last visit" boundary: everything above is new. The
             visible text carries the meaning; the ↑ is decorative (hidden from SR). -->
        {#if i === lastVisitDividerIndex}
          <div class="flex items-center gap-3 px-4 py-3" role="separator">
            <div class="flex-1 h-px bg-gradient-to-r from-transparent to-blue-800/50"></div>
            <span class="text-[10px] uppercase tracking-widest text-blue-400/70 whitespace-nowrap">New since your last visit <span aria-hidden="true">↑</span></span>
            <div class="flex-1 h-px bg-gradient-to-l from-transparent to-blue-800/50"></div>
          </div>
        {/if}
        <ClusterCard {cluster} onselect={(a) => selectedArticle = a} />
      {/each}
      {#if hasMore}
        <div class="py-6 text-center">
          <button
            id="feed-load-older"
            onclick={loadOlder}
            aria-disabled={loadingMore}
            class="text-sm text-gray-400 hover:text-gray-200 border border-gray-800 hover:border-gray-600 rounded-full px-5 py-2 transition-colors aria-disabled:opacity-50 aria-disabled:cursor-wait aria-disabled:hover:text-gray-400"
          >
            {loadingMore ? 'Loading…' : 'Load older stories'}
          </button>
        </div>
      {:else}
        <!-- Focus anchor: when the button above unmounts on the last page,
             loadOlder() moves focus here so keyboard users aren't dropped to body. -->
        <p id="feed-end" tabindex="-1" class="py-6 text-center text-xs text-gray-600 outline-none">
          You've reached the oldest stories.
        </p>
      {/if}
    {/if}
  </main>

  <!-- Mobile FAB: opens FilterSheet -->
  <button
    class="fixed right-4 z-30 md:hidden w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-colors"
    style="bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px))"
    onclick={() => filterSheetOpen = true}
    aria-label={isFiltered ? 'Open filters (active)' : 'Open filters'}
  >
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="4" y1="6" x2="20" y2="6"/>
      <line x1="4" y1="12" x2="16" y2="12"/>
      <line x1="4" y1="18" x2="12" y2="18"/>
    </svg>
    {#if isFiltered}
      <span class="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-[#0a0a0b]" aria-hidden="true"></span>
    {/if}
  </button>

  <!-- Mobile filter sheet -->
  <FilterSheet bind:open={filterSheetOpen} bind:activeRegions bind:searchQuery />

  <ArticlePanel article={selectedArticle} cluster={selectedCluster} onclose={() => selectedArticle = null} onselect={(a) => selectedArticle = a} />

  <!-- Persistent polite live region: mounted up-front (empty) so screen readers
       reliably announce when its text later changes — pagination results and
       deep-link recovery misses both flow through liveMessage. A region created
       in the same tick as its text is commonly missed by AT, so it stays mounted. -->
  <div class="sr-only" role="status" aria-live="polite">{liveMessage}</div>

  <!-- Transient toast — sighted-only mirror of recovery/pagination errors.
       Announcement is handled by the persistent live region above, so this
       carries no role to avoid a double announcement. -->
  {#if toast}
    <div
      class="fixed left-1/2 -translate-x-1/2 z-40 bg-gray-900 border border-gray-700 text-gray-200 text-sm px-4 py-2 rounded-full shadow-lg"
      style="bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px))"
      aria-hidden="true"
    >
      {toast}
    </div>
  {/if}
</div>
