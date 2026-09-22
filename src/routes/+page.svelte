<script lang="ts">
  import { onMount, untrack, tick } from 'svelte'
  import Header from '$lib/components/Header.svelte'
  import FilterSheet from '$lib/components/FilterSheet.svelte'
  import ArticlePanel from '$lib/components/ArticlePanel.svelte'
  import SignalFeed from '$lib/components/SignalFeed.svelte'
  import StoryDesk from '$lib/components/StoryDesk.svelte'
  import { createFeed } from '$lib/feed.svelte'
  import { createFilters } from '$lib/filters.svelte'
  import { createReaderRouting } from '$lib/deeplink.svelte'
  import { loadFeed } from '$lib/load-feed'

  // One home, two shapes, chosen by the screen rather than a toggle: Signal (one
  // story at a time, full screen) on a phone; the story desk (every story in a
  // column, the selected one beside it) on anything wide enough to scan. The
  // feed is loaded client-side, so nothing story-shaped renders before the
  // layout is known and neither shape flashes the other.
  const DESK_QUERY = '(min-width: 820px)'
  let desk = $state<boolean | null>(null)

  let loading = $state(true)
  let loadError = $state(false)

  // Realtime inserts queue instead of shifting the list under the reader: always
  // in Signal (a swipe in progress must not be yanked), on the desk once the
  // rail is scrolled away from the top.
  let railPaused = $state(false)
  let signalEpoch = $state(0)
  let isPaused = $derived(desk === false || railPaused)

  // Article list + realtime + pagination (src/lib/feed.svelte.ts), seeded once
  // from the load — later changes arrive over realtime, not through `data`.
  const feed = createFeed(
    untrack(() => ({
      articles: [],
      trending: [],
      lastUpdatedAt: null,
    })),
    { isPaused: () => isPaused },
  )
  // Search / region / language / signal filters + sort (src/lib/filters.svelte.ts).
  const filters = createFilters(() => feed.articles)
  // Reader shallow routing + ?article= / ?story= deep links
  // (src/lib/deeplink.svelte.ts). Must run during init: it registers an $effect
  // and an afterNavigate callback.
  const reader = createReaderRouting(feed)

  let filterSheetOpen = $state(false)
  let filterDropdownOpen = $state(false)

  // Install prompt
  let installPromptEvent = $state<BeforeInstallPromptEvent | null>(null)
  let installDismissed = $state(false)

  // Previous visit, frozen at mount so realtime prepends don't move the
  // "new since your last visit" line. null = first visit.
  let lastVisitAt = $state<number | null>(null)

  function flushQueue() {
    feed.flushQueue()
    signalEpoch += 1
  }

  // Leaving the queued state (the rail scrolled back to the top) releases what
  // arrived meanwhile, so nothing stays hidden behind a banner that no longer shows.
  $effect(() => {
    if (!isPaused && untrack(() => feed.newQueue.length) > 0) feed.flushQueue()
  })

  async function loadOlder() {
    // The large list re-render below blurs the focused control; if the user
    // drove this from the keyboard, restore focus afterward.
    const hadFocus = document.activeElement?.id === 'feed-load-older'
    if (!(await feed.loadOlder())) return
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
    const media = window.matchMedia(DESK_QUERY)
    desk = media.matches
    const onMedia = (e: MediaQueryListEvent) => { desk = e.matches }
    media.addEventListener('change', onMedia)

    filters.restoreSortMode()
    if (localStorage.getItem('pwa-install-dismissed')) {
      installDismissed = true
    }

    const prevVisit = Number(localStorage.getItem('ww3-last-visit'))
    lastVisitAt = Number.isFinite(prevVisit) && prevVisit > 0 ? prevVisit : null
    localStorage.setItem('ww3-last-visit', String(Date.now()))

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      installPromptEvent = e as BeforeInstallPromptEvent
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

    let cancelled = false
    void loadFeed().then(result => {
      if (cancelled) return
      feed.initialize(result)
      loadError = result.loadError
      loading = false
      feed.start()
    }).catch(() => { if (!cancelled) { loadError = true; loading = false } })

    return () => {
      cancelled = true
      media.removeEventListener('change', onMedia)
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      feed.stop()
    }
  })
</script>

<div class="h-dvh overflow-hidden bg-[#070809] flex flex-col">
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

  <!-- Install prompt banner (phones only, dismissible) -->
  {#if installPromptEvent && !installDismissed && desk === false}
    <div class="bg-blue-950/80 border-b border-blue-900 px-4 py-2 flex items-center gap-3">
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

  {#if filters.clustered.length === 0}
    <div class="flex-1 py-20 text-center text-gray-500 text-sm">
      {#if loading || desk === null}
        Loading the latest reporting…
      {:else if loadError && feed.articles.length === 0}
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
  {:else if desk}
    <StoryDesk
      clusters={filters.clustered}
      trending={feed.topStories}
      {reader}
      sortMode={filters.sortMode}
      onSortMode={filters.setSortMode}
      hasMore={feed.hasMore}
      loadingMore={feed.loadingMore}
      onLoadOlder={loadOlder}
      {lastVisitAt}
      newCount={feed.newQueue.length}
      onFlush={flushQueue}
      bind:paused={railPaused}
    />
  {:else if desk === false}
    <!-- New articles banner -->
    {#if feed.newQueue.length > 0}
      <div class="fixed left-1/2 -translate-x-1/2 z-20" style="top: calc(4rem + env(safe-area-inset-top, 0px))">
        <button
          onclick={flushQueue}
          class="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow-lg transition-colors"
        >
          ↑ {feed.newQueue.length} new {feed.newQueue.length === 1 ? 'story' : 'stories'}
        </button>
      </div>
    {/if}
    <div class="relative min-h-0 flex-1">
      {#key signalEpoch}
        <SignalFeed
          clusters={filters.clustered}
          onselect={reader.openArticle}
          onLoadOlder={filters.sortMode === 'latest' ? loadOlder : undefined}
          hasMore={feed.hasMore && filters.sortMode === 'latest'}
          loadingMore={feed.loadingMore}
          ranked={filters.sortMode === 'top'}
        />
      {/key}
    </div>
  {/if}

  <!-- Phone filters: a floating button opens the sheet. The desk has them in the header. -->
  <button
    class="fixed right-4 z-30 min-[820px]:hidden w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-colors"
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

  <FilterSheet
    bind:open={filterSheetOpen}
    bind:activeRegions={filters.activeRegions}
    bind:excludedLangs={filters.excludedLangs}
    availableLangs={filters.availableLangs}
    bind:searchQuery={filters.searchQuery}
    bind:signalFilter={filters.signalFilter}
    availableTopics={filters.availableTopics}
    availableActors={filters.availableActors}
    sortMode={filters.sortMode}
    onSortMode={filters.setSortMode}
  />

  <!-- On a phone the reader is a full-screen dialog; the desk hosts it in its pane. -->
  {#if !desk}
    <ArticlePanel article={reader.selectedArticle} cluster={reader.selectedCluster} onclose={reader.closeArticle} onselect={reader.openArticle} />
  {/if}

  <!-- Persistent polite live region: mounted up-front (empty) so screen readers
       reliably announce when its text later changes — pagination results and
       deep-link recovery misses both flow through liveMessage. -->
  <div class="sr-only" role="status" aria-live="polite">{feed.liveMessage}</div>

  <!-- Transient toast — sighted-only mirror of the live region above. -->
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
