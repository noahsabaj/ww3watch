<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import { tick } from 'svelte'
  import { timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import SiteMenu from '$lib/components/SiteMenu.svelte'

  let {
    searchQuery = $bindable(),
    storyCount,
    totalCount,
    isFiltered,
    realtimeStatus,
    lastUpdatedAt,
    staleness,
    ontheaters,
  }: {
    searchQuery: string
    storyCount: number
    totalCount: number
    isFiltered: boolean
    realtimeStatus: string
    lastUpdatedAt: string | null
    staleness: 'ok' | 'amber' | 'red' | null
    /** Phones: open the Theaters page. The desk lists theaters in its rail. */
    ontheaters?: () => void
  } = $props()

  const live = $derived(realtimeStatus === 'SUBSCRIBED')

  // Phones: the magnifying glass swaps the header row for a search field, and
  // Cancel clears the search and puts the row back. Wider screens keep the
  // field in the header.
  let searching = $state(false)
  let phoneField = $state<HTMLInputElement | null>(null)
  async function openSearch() {
    searching = true
    await tick()
    phoneField?.focus()
  }
  function cancelSearch() {
    searchQuery = ''
    searching = false
  }
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

<!-- Sticky so search and the menu stay one tap away; padding-top clears the
     iPhone notch (viewport-fit=cover). Solid ground, no blur: the sheets are
     fixed-position and a backdrop-filter would trap them inside the header. -->
<header
  class="sticky top-0 z-30 border-b border-line bg-ink px-4"
  style="padding-top: env(safe-area-inset-top, 0px)"
>
  {#if searching}
    <div class="flex h-16 items-center gap-3 min-[820px]:hidden">
      <label class="field flex min-h-10 flex-1 items-center gap-2 py-0">
        <Icon name="search" size={16} class="text-fg-3" />
        <input
          bind:this={phoneField}
          type="search"
          aria-label="Search headlines"
          placeholder="Search headlines"
          enterkeyhint="search"
          bind:value={searchQuery}
          onkeydown={(e) => { if (e.key === 'Escape') cancelSearch() }}
          class="min-w-0 flex-1 bg-transparent py-2 text-base text-fg outline-none placeholder:text-fg-3 [&::-webkit-search-cancel-button]:hidden"
        />
      </label>
      <button type="button" class="action -mr-1 px-2 text-[15px] text-accent" onclick={cancelSearch}>Cancel</button>
    </div>
  {/if}
  <div class="h-16 items-center gap-4 {searching ? 'hidden min-[820px]:flex' : 'flex'}">
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
      {#if ontheaters}
        <button type="button" class="icon-btn min-[820px]:hidden" aria-label="Theaters" onclick={ontheaters}>
          <Icon name="globe" size={20} />
        </button>
      {/if}
      <button
        type="button"
        class="icon-btn min-[820px]:hidden"
        aria-label="Search headlines"
        aria-expanded={searching}
        onclick={openSearch}
      >
        <Icon name="search" size={20} />
      </button>
      <SiteMenu />
    </div>
  </div>
  <p class="-mt-2 pb-2.5 text-xs text-fg-3 min-[820px]:hidden">{@render status()}</p>
  {#if staleness === 'amber' || staleness === 'red'}
    <p role="status" class="pb-2.5 text-xs text-amber-400">New reporting is delayed. Existing stories and original article links remain available.</p>
  {/if}
</header>
