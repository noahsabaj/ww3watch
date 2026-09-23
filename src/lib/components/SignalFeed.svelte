<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import SignalStory from '$lib/components/SignalStory.svelte'
  import PullIndicator from '$lib/components/PullIndicator.svelte'
  import { createPullRefresh } from '$lib/pull-refresh.svelte'

  let {
    clusters,
    onselect,
    onLoadOlder,
    hasMore,
    loadingMore,
    focusId = null,
    onview,
    onrefresh,
    ontheater,
    startId = null,
  }: {
    clusters: Cluster[]
    onselect?: (a: Article) => void
    onLoadOlder?: () => Promise<void>
    hasMore: boolean
    loadingMore: boolean
    /** The story the open reader belongs to. */
    focusId?: string | null
    /** The story on screen changed (not called for the first one on landing). */
    onview?: (cluster: Cluster) => void
    /** Pull down on the first story to fetch the newest; resolves when done. */
    onrefresh?: () => Promise<unknown>
    /** Narrow to a story's theater from its label; absent once narrowed. */
    ontheater?: (id: string, from: string) => void
    /** Open on this story instead of the first (read once, at mount). */
    startId?: string | null
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

  // Narrowing to a theater or back out remounts the feed; it opens on the story
  // the reader was on rather than jumping them to the top.
  let started = false
  $effect(() => {
    if (started || !scroller) return
    started = true
    if (!startId) return
    const story = scroller.querySelector<HTMLElement>(`[data-story="${CSS.escape(startId)}"]`)
    if (!story) return
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

  // The first story may have changed after a refresh; the address names the new one.
  const pullRefresh = createPullRefresh(() => scroller, () => onrefresh, () => {
    if (onScreen === 0 && reported && clusters[0]) onview?.(clusters[0])
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
  {#if onrefresh}<PullIndicator state={pullRefresh} />{/if}
  <!-- Focusable so arrow keys and Page Down move between stories: a scrolling
       region the keyboard can't reach is an axe failure (scrollable-region-focusable). -->
  <!-- No counter, no scrollbar: one story fills the screen and a swipe is the only control. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div bind:this={scroller} tabindex="0" aria-label="Stories"class="signal-scroller relative h-full snap-y snap-mandatory overflow-y-auto overscroll-y-contain bg-ink outline-none" aria-busy={pullRefresh.refreshing} style={pullRefresh.style} {onscroll}>
    {#each clusters as cluster, i (cluster.id)}
      <SignalStory {cluster} {onselect} ontheater={ontheater && ((id) => ontheater(id, cluster.id))} hint={i === 0 && !swiped && clusters.length > 1} />
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
        You’ve reached the oldest stories.
      </p>
    {/if}
  </div>
</div>
