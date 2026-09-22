<script lang="ts">
  import { onMount } from 'svelte'
  import type { Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import SignalStory from '$lib/components/SignalStory.svelte'

  let {
    clusters,
    onselect,
    onLoadOlder,
    hasMore,
    loadingMore,
  }: {
    clusters: Cluster[]
    onselect?: (a: Article) => void
    onLoadOlder?: () => Promise<void>
    hasMore: boolean
    loadingMore: boolean
  } = $props()

  let scroller: HTMLDivElement | undefined = $state()
  let activeId = $state<string | null>(null)
  const activeIndex = $derived(
    Math.max(0, clusters.findIndex((c) => c.id === activeId)),
  )

  onMount(() => {
    if (!scroller) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        const id = visible?.target.getAttribute('data-story')
        if (id) activeId = id
      },
      { root: scroller, threshold: 0.55 },
    )
    const watch = () => {
      observer.disconnect()
      for (const node of scroller?.querySelectorAll('[data-story]') ?? []) {
        observer.observe(node)
      }
    }
    watch()
    const mutation = new MutationObserver(() => watch())
    mutation.observe(scroller, { childList: true })
    return () => {
      observer.disconnect()
      mutation.disconnect()
    }
  })

  $effect(() => {
    if (clusters[0] && activeId === null) activeId = clusters[0].id
  })
</script>

<div class="relative h-full min-h-0">
  <div bind:this={scroller} class="h-full snap-y snap-mandatory overflow-y-auto">
    {#each clusters as cluster (cluster.id)}
      <SignalStory {cluster} {onselect} />
    {/each}
    {#if hasMore}
      <div class="flex h-full snap-start items-center justify-center px-6 text-center">
        <button
          id="feed-load-older"
          type="button"
          onclick={() => onLoadOlder?.()}
          aria-disabled={loadingMore}
          class="text-sm text-gray-300 border border-gray-700 rounded-full px-5 py-2 aria-disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load older stories'}
        </button>
      </div>
    {:else}
      <p id="feed-end" tabindex="-1" class="flex h-full snap-start items-center justify-center px-6 text-center text-xs text-gray-600 outline-none">
        You've reached the oldest stories.
      </p>
    {/if}
  </div>

  {#if clusters.length > 0}
    <p class="pointer-events-none absolute right-3 top-4 text-[11px] tabular-nums text-gray-500">
      {activeIndex + 1} / {clusters.length}
    </p>
  {/if}
</div>
