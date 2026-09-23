<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import type { Cluster } from '$lib/cluster'
  import { theaterOf } from '$lib/theaters'

  // Where a story is happening, above its headline. A tap narrows the feed to
  // that theater; once it is narrowed the place is just a label.
  let { cluster, onpick }: { cluster: Cluster; onpick?: (id: string) => void } = $props()

  const theater = $derived(theaterOf(cluster))
</script>

{#if theater}
  {#if onpick}
    <button
      type="button"
      data-theater-tag={theater.id}
      onclick={() => onpick(theater.id)}
      aria-label="Show only {theater.label} stories"
      class="place-chip min-h-7 gap-1 py-0.5 pr-2 pl-2.5 text-[11px] font-medium uppercase tracking-[0.16em] hover:bg-accent/10"
    >{theater.label}<Icon name="chevron-right" size={12} stroke={2.2} /></button>
  {:else}
    <span data-theater-tag={theater.id} class="text-[11px] font-medium uppercase tracking-[0.16em] text-fg">{theater.label}</span>
  {/if}
{/if}
