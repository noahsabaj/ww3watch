<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import type { SourceRegion } from '$lib/types'
  import { timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import type { Actor, SignalFilter, Topic } from '$lib/signals'
  import Sheet from '$lib/components/Sheet.svelte'
  import FilterPanel from '$lib/components/FilterPanel.svelte'
  import SiteMenu from '$lib/components/SiteMenu.svelte'

  let {
    searchQuery = $bindable(),
    activeRegions = $bindable(),
    excludedLangs = $bindable(),
    signalFilter = $bindable(),
    availableLangs,
    availableTopics,
    availableActors,
    onReset,
    storyCount,
    totalCount,
    isFiltered,
    realtimeStatus,
    lastUpdatedAt,
    staleness,
  }: {
    searchQuery: string
    activeRegions: Set<SourceRegion>
    excludedLangs: Set<string>
    signalFilter: SignalFilter
    availableLangs: { lang: string; count: number }[]
    availableTopics: { key: Topic; count: number }[]
    availableActors: { key: Actor; count: number }[]
    onReset: () => void
    storyCount: number
    totalCount: number
    isFiltered: boolean
    realtimeStatus: string
    lastUpdatedAt: string | null
    staleness: 'ok' | 'amber' | 'red' | null
  } = $props()

  let filtersOpen = $state(false)
  const live = $derived(realtimeStatus === 'SUBSCRIBED')
</script>

{#snippet status()}
  <!-- One flex row, so the dot, the count and the freshness share a line box
       (an inline-flex count next to plain inline text sat off-baseline). -->
  <span class="inline-flex items-center gap-1.5" title={live ? 'Live updates connected' : 'Live updates reconnecting'}>
    <span class="h-1.5 w-1.5 shrink-0 rounded-full {live ? 'bg-emerald-400 motion-safe:animate-pulse' : 'bg-fg-3'}" aria-hidden="true"></span>
    <span>{isFiltered ? `${storyCount.toLocaleString()} of ${totalCount.toLocaleString()}` : storyCount.toLocaleString()} stories</span>
    {#if lastUpdatedAt}
      <span
        class={staleness === 'red' ? 'text-red-400' : staleness === 'amber' ? 'text-amber-400' : ''}
        title="Ingestion last completed {new Date(lastUpdatedAt).toLocaleString()} — runs about every 15 min{staleness === 'red' || staleness === 'amber' ? '. New reporting is delayed; existing stories remain available.' : ''}"
      >· updated {timeAgo(lastUpdatedAt, clock.now)}</span>
    {/if}
  </span>
{/snippet}

<!-- Sticky so filters and the menu stay one tap away; padding-top clears the
     iPhone notch (viewport-fit=cover). Solid ground, no blur: the sheets are
     fixed-position and a backdrop-filter would trap them inside the header. -->
<header
  class="sticky top-0 z-30 border-b border-line bg-ink px-4"
  style="padding-top: env(safe-area-inset-top, 0px)"
>
  <div class="flex h-16 items-center gap-4">
    <h1 class="shrink-0 text-lg font-bold tracking-tight text-fg">WW3Watch</h1>

    <input
      type="search"
      aria-label="Search headlines"
      placeholder="Search headlines"
      bind:value={searchQuery}
      class="field hidden max-w-md min-h-10 py-2 text-sm min-[820px]:block"
    />

    <div class="ml-auto flex items-center gap-1">
      <p class="mr-3 hidden text-xs text-fg-3 min-[820px]:block" aria-live="off">{@render status()}</p>
      <button
        type="button"
        class="icon-btn"
        aria-label={isFiltered ? 'Open filters (active)' : 'Open filters'}
        aria-haspopup="dialog"
        aria-expanded={filtersOpen}
        onclick={() => (filtersOpen = true)}
      >
        <Icon name="filters" size={20} />
        {#if isFiltered}<span class="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-ink" aria-hidden="true"></span>{/if}
      </button>
      <SiteMenu />
    </div>
  </div>
  <p class="-mt-2 pb-2.5 text-xs text-fg-3 min-[820px]:hidden">{@render status()}</p>
  {#if staleness === 'amber' || staleness === 'red'}
    <p role="status" class="pb-2.5 text-xs text-amber-400">New reporting is delayed. Existing stories and original article links remain available.</p>
  {/if}
</header>

<Sheet bind:open={filtersOpen} title="Filters" id="feed-filters">
  <FilterPanel
    bind:activeRegions
    bind:excludedLangs
    bind:searchQuery
    bind:signalFilter
    {availableLangs}
    {availableTopics}
    {availableActors}
    showSearch
  />
  {#snippet footer()}
    <div class="flex items-center justify-between gap-3">
      <button type="button" class="action text-sm disabled:opacity-40" disabled={!isFiltered} onclick={onReset}>Reset</button>
      <button type="button" class="btn" onclick={() => (filtersOpen = false)}>
        Show {storyCount.toLocaleString()} {storyCount === 1 ? 'story' : 'stories'}
      </button>
    </div>
  {/snippet}
</Sheet>
