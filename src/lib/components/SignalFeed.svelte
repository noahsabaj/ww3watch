<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import SignalStory from '$lib/components/SignalStory.svelte'
  import Icon from '$lib/components/Icon.svelte'

  let {
    clusters,
    onselect,
    onLoadOlder,
    hasMore,
    loadingMore,
    ranked = false,
    focusId = null,
    onview,
    onrefresh,
  }: {
    clusters: Cluster[]
    onselect?: (a: Article) => void
    onLoadOlder?: () => Promise<void>
    hasMore: boolean
    loadingMore: boolean
    /** Top order: the list ends at the 24h window, not at the oldest story. */
    ranked?: boolean
    /** The story the open reader belongs to. */
    focusId?: string | null
    /** The story on screen changed (not called for the first one on landing). */
    onview?: (cluster: Cluster) => void
    /** Pull down on the first story to fetch the newest; resolves when done. */
    onrefresh?: () => Promise<unknown>
  } = $props()

  // A first-time visitor sees one story and no scrollbar, so nothing says there
  // is more. The first story carries a swipe cue until they have swiped once.
  const HINT_KEY = 'ww3-swiped'
  let swiped = $state(true)
  $effect(() => {
    try { swiped = localStorage.getItem(HINT_KEY) === '1' } catch { swiped = false }
  })
  // The story behind the open reader sits under it, so closing the reader lands
  // on that story, even when the reader was opened by a link or by coming back
  // from Report or Source profile, when the feed has just remounted at the top.
  let scroller = $state<HTMLElement | null>(null)
  let jumpedAt = -Infinity
  $effect(() => {
    if (!focusId || !scroller) return
    void clusters.length
    const story = scroller.querySelector<HTMLElement>(`[data-story="${CSS.escape(focusId)}"]`)
    if (!story || Math.abs(story.offsetTop - scroller.scrollTop) < 2) return
    jumpedAt = performance.now()
    scroller.scrollTo({ top: story.offsetTop, behavior: 'instant' })
  })

  // The story on screen, so the address bar (and Safari's own Share button)
  // names it rather than the homepage.
  let onScreen = 0
  let reported = false
  function reportView(el: HTMLElement) {
    const i = Math.round(el.scrollTop / Math.max(1, el.clientHeight))
    if (i === onScreen) return
    onScreen = i
    if (clusters[i]) { reported = true; onview?.(clusters[i]) }
  }

  // Pull to refresh, as in every feed app: drag the first story down and let
  // go past the line. The first downward move at the top is claimed before the
  // browser starts its own rubber band (after that, touchmove can no longer be
  // cancelled), and the stories follow the finger at half speed.
  const PULL_LINE = 64
  const PULL_MAX = 110
  const PULL_HOLD = 56
  let pull = $state(0)
  let dragging = $state(false)
  let refreshing = $state(false)
  $effect(() => {
    const el = scroller
    if (!el || !onrefresh) return
    let startX = 0, startY = 0
    let tracking = false
    function start(e: TouchEvent) {
      tracking = !refreshing && e.touches.length === 1 && el!.scrollTop <= 0
      if (!tracking) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }
    function move(e: TouchEvent) {
      if (!tracking) return
      const dy = e.touches[0].clientY - startY
      const dx = e.touches[0].clientX - startX
      if (!dragging) {
        if (dy === 0) return
        if (dy < 0 || Math.abs(dx) > dy || el!.scrollTop > 0) { tracking = false; return }
        dragging = true
      }
      if (e.cancelable) e.preventDefault()
      pull = Math.min(PULL_MAX, Math.max(0, dy) / 2)
    }
    async function end() {
      tracking = false
      if (!dragging) return
      dragging = false
      if (pull < PULL_LINE) { pull = 0; return }
      refreshing = true
      pull = PULL_HOLD
      try { await onrefresh!() } finally {
        refreshing = false
        pull = 0
      }
      // The first story may have changed; the address names the new one.
      if (onScreen === 0 && reported && clusters[0]) onview?.(clusters[0])
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  })

  function onscroll(e: Event) {
    reportView(e.currentTarget as HTMLElement)
    if (performance.now() - jumpedAt < 500) return
    if (swiped || (e.currentTarget as HTMLElement).scrollTop < 48) return
    swiped = true
    try { localStorage.setItem(HINT_KEY, '1') } catch { /* private mode */ }
  }
</script>

<div class="relative h-full min-h-0 overflow-hidden">
  {#if onrefresh}
    <!-- Behind the stories: uncovered as they are pulled down. -->
    <div
      data-pull-indicator
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center text-fg-2"
      style="height: {PULL_HOLD}px; opacity: {refreshing ? 1 : Math.min(1, pull / PULL_LINE)}"
    >
      <span
        class="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-panel {refreshing ? 'animate-spin' : ''} {pull >= PULL_LINE || refreshing ? 'text-accent' : ''}"
        style={refreshing ? undefined : `transform: rotate(${(pull / PULL_LINE) * 270}deg)`}
      >
        <Icon name="refresh" size={15} stroke={2} />
      </span>
    </div>
  {/if}
  <!-- Focusable so arrow keys and Page Down move between stories: a scrolling
       region the keyboard can't reach is an axe failure (scrollable-region-focusable). -->
  <!-- No counter, no scrollbar: one story fills the screen and a swipe is the only control. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div bind:this={scroller} tabindex="0" aria-label="Stories"class="signal-scroller relative h-full snap-y snap-mandatory overflow-y-auto overscroll-y-contain bg-ink outline-none" aria-busy={refreshing} style="transform: {pull ? `translateY(${pull}px)` : 'none'}; transition: {dragging ? 'none' : 'transform 0.25s ease'}" {onscroll}>
    {#each clusters as cluster, i (cluster.id)}
      <SignalStory {cluster} {onselect} hint={i === 0 && !swiped && clusters.length > 1} />
    {/each}
    {#if hasMore}
      <div class="flex h-full snap-start items-center justify-center px-6 text-center">
        <button
          id="feed-load-older"
          type="button"
          onclick={() => onLoadOlder?.()}
          aria-disabled={loadingMore}
          class="btn-ghost text-sm aria-disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load older stories'}
        </button>
      </div>
    {:else}
      <p id="feed-end" tabindex="-1" class="flex h-full snap-start items-center justify-center px-6 text-center text-xs text-fg-3 outline-none">
        {ranked ? 'That’s every ranked story from the last 24 hours.' : 'You’ve reached the oldest stories.'}
      </p>
    {/if}
  </div>
</div>
