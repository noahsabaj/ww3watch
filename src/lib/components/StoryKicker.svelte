<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import { langTag } from '$lib/utils'
  import { storyBadgeSignals } from '$lib/story'
  import SignalBadges from '$lib/components/SignalBadges.svelte'
  import TheaterTag from '$lib/components/TheaterTag.svelte'
  import { disputedFor } from '$lib/story-notes.svelte'

  // The line above a story's headline, the same on Signal and the desk: where
  // it's happening, whose newsroom leads it and in what language, the story's
  // badges, and whether the headline below is our translation.
  let {
    cluster,
    translated = false,
    ontheater,
    class: cls = '',
  }: {
    cluster: Cluster
    translated?: boolean
    /** Narrow the feed to this story's theater; absent once it is narrowed. */
    ontheater?: (id: string) => void
    class?: string
  } = $props()

  const rep = $derived(cluster.representative)
  const lang = $derived(langTag(rep.source_lang))
</script>

<div class="flex flex-wrap items-center gap-2 {cls}">
  <TheaterTag {cluster} onpick={ontheater} />
  <span class="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-2">{rep.source_region} outlet</span>
  {#if lang}
    <span class="rounded border border-line px-1 font-mono text-[9px] uppercase tracking-wide text-fg-3">{lang}</span>
  {/if}
  <SignalBadges article={storyBadgeSignals(cluster)} disputed={disputedFor(cluster.storyId)} />
  {#if translated}
    <span class="text-[10px] font-medium uppercase tracking-[0.12em] text-fg-3">Translated</span>
  {/if}
</div>
