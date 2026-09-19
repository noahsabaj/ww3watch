<script lang="ts">
  import { onMount, untrack, tick } from 'svelte'
  import type { Article } from '$lib/types'
  import Header from '$lib/components/Header.svelte'
  import ClusterCard from '$lib/components/ClusterCard.svelte'
  import TopStories from '$lib/components/TopStories.svelte'
  import FilterSheet from '$lib/components/FilterSheet.svelte'
  import ArticlePanel from '$lib/components/ArticlePanel.svelte'
  import { dayKey, dayLabel } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import { createFeed, type TrendingRef } from '$lib/feed.svelte'
  import { createFilters } from '$lib/filters.svelte'
  import { createReaderRouting } from '$lib/deeplink.svelte'
  import type { Cluster } from '$lib/cluster'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  let scrollY = $state(0)
  let isPaused = $derived(scrollY > 300)

  // Article list + realtime + pagination (src/lib/feed.svelte.ts), seeded once
  // from the load — later changes arrive over realtime, not through `data`.
  const feed = createFeed(
    untrack(() => ({
      articles: (data.articles as Article[]) ?? [],
      trending: (data.trending as TrendingRef[]) ?? [],
      lastUpdatedAt: (data.lastUpdatedAt as string | null) ?? null,
    })),
    { isPaused: () => isPaused },
  )
  // Search / region / language / signal filters + sort (src/lib/filters.svelte.ts).
  const filters = createFilters(() => feed.articles)
  // Reader panel shallow routing + ?article= / ?story= deep links
  // (src/lib/deeplink.svelte.ts). Must run during init: it registers an $effect
  // and an afterNavigate callback.
  const reader = createReaderRouting(feed)

  let filterSheetOpen = $state(false)
  let filterDropdownOpen = $state(false)

  // Install prompt
  let installPromptEvent = $state<BeforeInstallPromptEvent | null>(null)
  let installDismissed = $state(false)

  // "New since your last visit" marker, frozen at mount so realtime prepends
  // don't move the line. localStorage is rewritten to now on each visit.
  let lastVisitAt = $state<number | null>(null)

  // Index of the first cluster older than the last visit. The feed is DESC, so
  // this is the boundary between "new since you were here" (above) and "seen
  // before" (below). -1 = no marker (first visit, or nothing new, or all new).
  let lastVisitDividerIndex = $derived.by(() => {
    if (lastVisitAt === null || filters.sortMode === 'top') return -1
    const clustered = filters.clustered
    const t = (c: Cluster) => (c.representative.published_at ? Date.parse(c.representative.published_at) : 0)
    for (let i = 1; i < clustered.length; i++) {
      if (t(clustered[i - 1]) > lastVisitAt && t(clustered[i]) <= lastVisitAt) return i
    }
    return -1
  })

  function flushQueue() {
    feed.flushQueue()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  async function loadOlder() {
    // The large list re-render below blurs the focused control; if the user
    // drove this from the keyboard, restore focus afterward (mouse users are
    // left alone — :focus-visible keeps the ring keyboard-only anyway).
    const hadFocus = document.activeElement?.id === 'feed-load-older'
    if (!(await feed.loadOlder())) return
    // Restore focus to the button (or the end marker, once the button unmounts
    // on the final page) so a keyboard user isn't dropped to <body>. tick() flushes
    // the append render; rAF then runs after the browser settles that layout, so
    // focus lands on the live element rather than a torn-down one.
    if (hadFocus) {
      await tick()
      requestAnimationFrame(() => {
        document.getElementById(feed.hasMore ? 'feed-load-older' : 'feed-end')?.focus()
      })
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
    filters.restoreSortMode()
    if (localStorage.getItem('pwa-install-dismissed')) {
      installDismissed = true
    }

    // "New since your last visit" marker: read the previous visit, then stamp now.
    const prevVisit = Number(localStorage.getItem('ww3-last-visit'))
    lastVisitAt = Number.isFinite(prevVisit) && prevVisit > 0 ? prevVisit : null
    localStorage.setItem('ww3-last-visit', String(Date.now()))

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      installPromptEvent = e as BeforeInstallPromptEvent
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

    feed.start()

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      feed.stop()
    }
  })
</script>

<svelte:window bind:scrollY />

<div class="min-h-screen bg-[#0a0a0b]">
  <Header
    bind:searchQuery={filters.searchQuery}
    bind:activeRegions={filters.activeRegions}
    bind:excludedLangs={filters.excludedLangs}
    availableLangs={filters.availableLangs}
    bind:signalFilter={filters.signalFilter}
    availableTopics={filters.availableTopics}
    availableActors={filters.availableActors}
    bind:filterDropdownOpen
    storyCount={filters.clustered.length}
    totalCount={Math.max(feed.allClustered.length, filters.clustered.length)}
    isFiltered={filters.isFiltered}
    realtimeStatus={feed.realtimeStatus}
    lastUpdatedAt={feed.lastUpdatedAt}
    staleness={feed.staleness}
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
  <TopStories stories={feed.topStories} onselect={reader.openArticle} />

  <!-- New articles banner -->
  {#if feed.newQueue.length > 0 && isPaused}
    <!-- 4rem clears the sticky header (~59px on md+ where the search input sets row height) -->
    <div class="fixed left-1/2 -translate-x-1/2 z-20" style="top: calc(4rem + env(safe-area-inset-top, 0px))">
      <button
        onclick={flushQueue}
        class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow-lg transition-colors"
      >
        ↑ {feed.newQueue.length} new {feed.newQueue.length === 1 ? 'article' : 'articles'}
      </button>
    </div>
  {/if}

  <!-- Feed -->
  <main
    class="max-w-3xl mx-auto divide-y divide-gray-800/50"
    style="padding-bottom: calc(5rem + env(safe-area-inset-bottom, 0px))"
  >
    {#if feed.articles.length > 0}
      <div class="flex items-center gap-1 px-4 pt-2" role="group" aria-label="Feed order">
        {#each [['latest', 'Latest'], ['top', 'Top · 24h']] as [mode, label] (mode)}
          <button
            onclick={() => filters.setSortMode(mode as 'latest' | 'top')}
            aria-pressed={filters.sortMode === mode}
            title={mode === 'top' ? 'The last 24 hours, ranked by severity, independent corroboration and recency' : 'Newest first'}
            class="text-[11px] px-2.5 py-1 rounded-full border transition-colors {filters.sortMode === mode ? 'border-blue-500/50 bg-blue-600/15 text-blue-300' : 'border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600'}"
          >{label}</button>
        {/each}
      </div>
    {/if}
    {#if filters.clustered.length === 0}
      <div class="py-20 text-center text-gray-500 text-sm">
        {#if data.loadError && feed.articles.length === 0}
          <p class="mb-3">Couldn't load the feed.</p>
          <button
            onclick={() => location.reload()}
            class="text-blue-400 hover:text-blue-300 border border-gray-700 hover:border-gray-500 rounded px-3 py-1.5 transition-colors"
          >
            Retry
          </button>
        {:else if feed.articles.length === 0}
          No stories yet — new ones appear here live.
        {:else if filters.sortMode === 'top' && filters.latestClustered.length > 0}
          <p class="mb-3">Nothing from the last 24 hours matches.</p>
          <button
            onclick={() => filters.setSortMode('latest')}
            class="text-blue-400 hover:text-blue-300 border border-gray-700 hover:border-gray-500 rounded px-3 py-1.5 transition-colors"
          >
            Show latest
          </button>
        {:else}
          <p class="mb-3">No stories match your filters.</p>
          <button
            onclick={filters.clearFilters}
            class="text-blue-400 hover:text-blue-300 border border-gray-700 hover:border-gray-500 rounded px-3 py-1.5 transition-colors"
          >
            Clear filters
          </button>
        {/if}
      </div>
    {:else}
      {#each filters.clustered as cluster, i (cluster.id)}
        <!-- Day separator at each calendar-day boundary — safe because
             groupByClusterId sorts by representative published_at DESC. -->
        {#if filters.sortMode === 'latest' && (i === 0 || dayKey(cluster.representative.published_at, clock.now) !== dayKey(filters.clustered[i - 1].representative.published_at, clock.now))}
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
        <ClusterCard {cluster} onselect={reader.openArticle} />
      {/each}
      {#if feed.hasMore && filters.sortMode === 'latest'}
        <div class="py-6 text-center">
          <button
            id="feed-load-older"
            onclick={loadOlder}
            aria-disabled={feed.loadingMore}
            class="text-sm text-gray-400 hover:text-gray-200 border border-gray-800 hover:border-gray-600 rounded-full px-5 py-2 transition-colors aria-disabled:opacity-50 aria-disabled:cursor-wait aria-disabled:hover:text-gray-400"
          >
            {feed.loadingMore ? 'Loading…' : 'Load older stories'}
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
    aria-label={filters.isFiltered ? 'Open filters (active)' : 'Open filters'}
  >
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <line x1="4" y1="6" x2="20" y2="6"/>
      <line x1="4" y1="12" x2="16" y2="12"/>
      <line x1="4" y1="18" x2="12" y2="18"/>
    </svg>
    {#if filters.isFiltered}
      <span class="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-[#0a0a0b]" aria-hidden="true"></span>
    {/if}
  </button>

  <!-- Mobile filter sheet -->
  <FilterSheet bind:open={filterSheetOpen} bind:activeRegions={filters.activeRegions} bind:excludedLangs={filters.excludedLangs} availableLangs={filters.availableLangs} bind:searchQuery={filters.searchQuery} bind:signalFilter={filters.signalFilter} availableTopics={filters.availableTopics} availableActors={filters.availableActors} />

  <ArticlePanel article={reader.selectedArticle} cluster={reader.selectedCluster} onclose={reader.closeArticle} onselect={reader.openArticle} />

  <!-- Persistent polite live region: mounted up-front (empty) so screen readers
       reliably announce when its text later changes — pagination results and
       deep-link recovery misses both flow through liveMessage. A region created
       in the same tick as its text is commonly missed by AT, so it stays mounted. -->
  <div class="sr-only" role="status" aria-live="polite">{feed.liveMessage}</div>

  <!-- Transient toast — sighted-only mirror of recovery/pagination errors.
       Announcement is handled by the persistent live region above, so this
       carries no role to avoid a double announcement. -->
  {#if feed.toast}
    <div
      class="fixed left-1/2 -translate-x-1/2 z-40 bg-gray-900 border border-gray-700 text-gray-200 text-sm px-4 py-2 rounded-full shadow-lg"
      style="bottom: calc(5.5rem + env(safe-area-inset-bottom, 0px))"
      aria-hidden="true"
    >
      {feed.toast}
    </div>
  {/if}
</div>
