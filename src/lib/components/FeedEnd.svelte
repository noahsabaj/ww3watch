<script lang="ts">
  // The foot of the story list, on Signal and the desk: fetch older stories,
  // or say there are none. The ids are where +page.svelte returns keyboard
  // focus after a load, so they must stay unique on the page.
  let { hasMore, loadingMore, onLoadOlder, class: cls = '' }: {
    hasMore: boolean
    loadingMore: boolean
    onLoadOlder?: () => unknown
    class?: string
  } = $props()
</script>

<div class={cls}>
  {#if hasMore}
    <button
      id="feed-load-older"
      type="button"
      onclick={() => onLoadOlder?.()}
      aria-disabled={loadingMore}
      class="btn-ghost text-sm aria-disabled:opacity-50"
    >{loadingMore ? 'Loading…' : 'Load older stories'}</button>
  {:else}
    <p id="feed-end" tabindex="-1" class="text-xs text-fg-3 outline-none">You’ve reached the oldest stories.</p>
  {/if}
</div>
