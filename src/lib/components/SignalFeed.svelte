<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import SignalStory from '$lib/components/SignalStory.svelte'

  let {
    clusters,
    onselect,
    onLoadOlder,
    hasMore,
    loadingMore,
    ranked = false,
  }: {
    clusters: Cluster[]
    onselect?: (a: Article) => void
    onLoadOlder?: () => Promise<void>
    hasMore: boolean
    loadingMore: boolean
    /** Top order: the list ends at the 24h window, not at the oldest story. */
    ranked?: boolean
  } = $props()

  // A first-time visitor sees one story and no scrollbar, so nothing says there
  // is more. The first story carries a swipe cue until they have swiped once.
  const HINT_KEY = 'ww3-swiped'
  let swiped = $state(true)
  $effect(() => {
    try { swiped = localStorage.getItem(HINT_KEY) === '1' } catch { swiped = false }
  })
  function onscroll(e: Event) {
    if (swiped || (e.currentTarget as HTMLElement).scrollTop < 48) return
    swiped = true
    try { localStorage.setItem(HINT_KEY, '1') } catch { /* private mode */ }
  }
</script>

<div class="relative h-full min-h-0">
  <!-- Focusable so arrow keys and Page Down move between stories: a scrolling
       region the keyboard can't reach is an axe failure (scrollable-region-focusable). -->
  <!-- No counter, no scrollbar: one story fills the screen and a swipe is the only control. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div tabindex="0" aria-label="Stories" class="signal-scroller h-full snap-y snap-mandatory overflow-y-auto outline-none" {onscroll}>
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
