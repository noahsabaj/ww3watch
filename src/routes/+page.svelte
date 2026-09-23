<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import { onMount, untrack, tick } from 'svelte'
  import Header from '$lib/components/Header.svelte'
  import ArticlePanel from '$lib/components/ArticlePanel.svelte'
  import SignalFeed from '$lib/components/SignalFeed.svelte'
  import StoryDesk from '$lib/components/StoryDesk.svelte'
  import { createFeed } from '$lib/feed.svelte'
  import { createSearch } from '$lib/search.svelte'
  import { createReaderRouting } from '$lib/deeplink.svelte'
  import { loadFeed } from '$lib/load-feed'
  import { shareTarget } from '$lib/share'
  import { replaceState } from '$app/navigation'
  import { base } from '$app/paths'
  import type { Cluster } from '$lib/cluster'

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
  // Headline search, the feed's only narrowing (src/lib/search.svelte.ts).
  const search = createSearch(() => feed.articles)
  // Reader shallow routing + ?article= / ?story= deep links
  // (src/lib/deeplink.svelte.ts). Must run during init: it registers an $effect
  // and an afterNavigate callback.
  const reader = createReaderRouting(feed)


  // Install prompt
  let installPromptEvent = $state<BeforeInstallPromptEvent | null>(null)
  let installDismissed = $state(false)

  // Previous visit, frozen at mount so realtime prepends don't move the
  // "new since your last visit" line. null = first visit.
  let lastVisitAt = $state<number | null>(null)

  // Signal: the address follows the story on screen, so sharing the page from
  // the browser sends that story, same link as the Share button. Left alone
  // while the reader is open; it owns the URL then.
  function onSignalView(cluster: Cluster) {
    if (reader.selectedArticle) return
    const { search } = new URL(shareTarget(cluster.representative, cluster).url)
    replaceState(`${base}/${search}`, {})
  }

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

  // In the iPhone home-screen app the page draws under the translucent status
  // bar, but iOS still reports a viewport one status bar shorter than the
  // screen, so a frame pinned to the viewport stopped ~60px above the bottom
  // and left an empty band under every story. Viewport units and fixed
  // positioning both inherit that short viewport; the screen size does not.
  // Only a full-screen standalone app is touched, and only when it falls short.
  let frame = $state<HTMLElement | null>(null)
  function fitScreen() {
    if (!frame || !(navigator as Navigator & { standalone?: boolean }).standalone) return
    const portrait = innerHeight >= innerWidth
    const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height)
    const across = portrait ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)
    frame.style.height = ''
    // An iPad in Split View or Stage Manager is narrower than the screen on purpose.
    if (Math.abs(innerWidth - across) > 1) return
    if (full > frame.getBoundingClientRect().height + 1) frame.style.height = `${full}px`
  }

  onMount(() => {
    fitScreen()
    addEventListener('resize', fitScreen)
    addEventListener('orientationchange', fitScreen)
    const media = window.matchMedia(DESK_QUERY)
    desk = media.matches
    const onMedia = (e: MediaQueryListEvent) => { desk = e.matches }
    media.addEventListener('change', onMedia)

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
      removeEventListener('resize', fitScreen)
      removeEventListener('orientationchange', fitScreen)
      feed.stop()
    }
  })
</script>

<!-- Pinned to the viewport's edges; in the iPhone home-screen app fitScreen()
     stretches it to the real screen (see there). -->
<div bind:this={frame} data-app-frame class="fixed inset-0 overflow-hidden bg-ink flex flex-col">
  <Header
    bind:searchQuery={search.query}
    storyCount={search.clustered.length}
    totalCount={Math.max(feed.allClustered.length, search.clustered.length)}
    isFiltered={search.active}
    realtimeStatus={feed.realtimeStatus}
    lastUpdatedAt={feed.lastUpdatedAt}
    staleness={feed.staleness}
  />

  <!-- Install prompt (phones only, dismissible) -->
  {#if installPromptEvent && !installDismissed && desk === false}
    <div class="flex items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
      <span class="flex-1 text-sm text-fg-2">Add WW3Watch to your home screen</span>
      <button onclick={handleInstall} class="btn min-h-8 px-4 text-[13px]">Install</button>
      <button onclick={dismissInstall} class="icon-btn -mr-2 h-9 w-9" aria-label="Dismiss">
        <Icon name="close" size={16} stroke={2} />
      </button>
    </div>
  {/if}

  {#if search.clustered.length === 0}
    <div class="flex-1 px-6 py-24 text-center text-sm text-fg-3">
      {#if loading || desk === null}
        Loading the latest reporting…
      {:else if loadError && feed.articles.length === 0}
        <p class="mb-4 font-serif text-xl text-fg">Couldn't load the feed.</p>
        <button
          onclick={() => location.reload()}
          class="btn-ghost"
        >
          Retry
        </button>
      {:else if feed.articles.length === 0}
        No stories yet — new ones appear here live.
      {:else}
        <p class="mb-4 font-serif text-xl text-fg">No stories match “{search.query.trim()}”.</p>
        <button
          onclick={search.clear}
          class="btn-ghost"
        >
          Clear search
        </button>
      {/if}
    </div>
  {:else if desk}
    <StoryDesk
      clusters={search.clustered}
      trending={feed.topStories}
      {reader}
      hasMore={feed.hasMore}
      loadingMore={feed.loadingMore}
      onLoadOlder={loadOlder}
      {lastVisitAt}
      newCount={feed.newQueue.length}
      onFlush={flushQueue}
      onrefresh={feed.refresh}
      bind:paused={railPaused}
    />
  {:else if desk === false}
    <!-- New articles banner -->
    {#if feed.newQueue.length > 0}
      <div class="fixed left-1/2 -translate-x-1/2 z-20" style="top: calc(6.5rem + env(safe-area-inset-top, 0px))">
        <button
          onclick={flushQueue}
          class="btn min-h-9 gap-1.5 px-4 text-[13px] shadow-lg shadow-black/50"
        >
          <Icon name="arrow-up" size={14} />{feed.newQueue.length} new {feed.newQueue.length === 1 ? 'story' : 'stories'}
        </button>
      </div>
    {/if}
    <div class="relative min-h-0 flex-1">
      {#key signalEpoch}
        <SignalFeed
          clusters={search.clustered}
          onselect={reader.openArticle}
          onLoadOlder={loadOlder}
          hasMore={feed.hasMore}
          loadingMore={feed.loadingMore}
          focusId={reader.selectedCluster?.id ?? null}
          onview={onSignalView}
          onrefresh={feed.refresh}
        />
      {/key}
    </div>
  {/if}

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
      class="fixed left-1/2 -translate-x-1/2 z-40 rounded-full border border-line bg-panel px-4 py-2 text-sm text-fg shadow-lg shadow-black/50"
      style="bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px))"
      aria-hidden="true"
    >
      {feed.toast}
    </div>
  {/if}
</div>
