<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { ALL_REGIONS, REGION_COLORS } from '$lib/types'
  import { timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import { base } from '$app/paths'

  let {
    searchQuery = $bindable(),
    activeRegions = $bindable(),
    filterDropdownOpen = $bindable(),
    storyCount,
    totalCount,
    isFiltered,
    realtimeStatus,
    lastUpdatedAt,
    staleness,
  }: {
    searchQuery: string
    activeRegions: Set<SourceRegion>
    filterDropdownOpen: boolean
    storyCount: number
    totalCount: number
    isFiltered: boolean
    realtimeStatus: string
    lastUpdatedAt: string | null
    staleness: 'ok' | 'amber' | 'red' | null
  } = $props()

  function toggleRegion(region: SourceRegion) {
    const next = new Set(activeRegions)
    if (next.has(region)) next.delete(region)
    else next.add(region)
    activeRegions = next
  }
  function selectAll() { activeRegions = new Set(ALL_REGIONS) }
  function clearAll() { activeRegions = new Set() }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && filterDropdownOpen) filterDropdownOpen = false
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Header — padding-top accounts for iOS notch via viewport-fit=cover.
     Sticky so search/filter stay reachable on a very long feed. Solid bg on
     purpose: backdrop-blur would create a containing block and shrink the
     filter dropdown's fixed click-away backdrop to the header box. -->
<header
  class="sticky top-0 z-30 border-b border-gray-800 px-4 py-3 bg-[#0a0a0b]"
  style="padding-top: calc(0.75rem + env(safe-area-inset-top, 0px))"
>
  <div class="max-w-3xl mx-auto flex items-center gap-3">
    <!-- Brand -->
    <div class="flex items-center gap-3 shrink-0">
      <h1 class="text-white font-bold text-lg tracking-tight">WW3Watch</h1>
    </div>

    <!-- Search input (desktop only) -->
    <input
      type="text"
      placeholder="Search headlines..."
      bind:value={searchQuery}
      class="hidden md:block flex-1 min-w-0 bg-[#18181b] border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
    />

    <!-- Right actions -->
    <div class="flex items-center gap-2 ml-auto md:ml-0 shrink-0">
      <span
        class="flex items-center gap-1.5 text-xs text-gray-500"
        title={realtimeStatus === 'SUBSCRIBED' ? 'Live updates connected' : 'Live updates reconnecting'}
        aria-label={realtimeStatus === 'SUBSCRIBED' ? 'Live updates connected' : 'Live updates reconnecting'}
      >
        <span class="w-1.5 h-1.5 rounded-full {realtimeStatus === 'SUBSCRIBED' ? 'bg-green-500 motion-safe:animate-pulse' : 'bg-gray-600'}"></span>
        {#if isFiltered}
          {storyCount.toLocaleString()} of {totalCount.toLocaleString()} stories
        {:else}
          {storyCount.toLocaleString()} stories
        {/if}
        {#if lastUpdatedAt}
          <span
            class={staleness === 'red' ? 'text-red-400' : staleness === 'amber' ? 'text-amber-500' : 'text-gray-600'}
            title="Ingestion last completed {new Date(lastUpdatedAt).toLocaleString()} — runs every ~30–120 min{staleness === 'red' ? '. The pipeline appears to be down.' : staleness === 'amber' ? '. Several runs appear to have been missed.' : ''}"
          >
            · updated {timeAgo(lastUpdatedAt, clock.now)}
          </span>
        {/if}
      </span>

      <!-- Region filter button + dropdown (desktop only) -->
      <div class="relative hidden md:block">
        <button
          onclick={() => filterDropdownOpen = !filterDropdownOpen}
          aria-label="Filter by region"
          aria-haspopup="true"
          aria-expanded={filterDropdownOpen}
          aria-controls="region-filter-dropdown"
          class="flex items-center justify-center w-7 h-7 rounded transition-colors {filterDropdownOpen || activeRegions.size < ALL_REGIONS.length ? 'text-blue-400' : 'text-gray-600 hover:text-gray-300'}"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
            <circle cx="9" cy="18" r="2" fill="currentColor" stroke="none"/>
          </svg>
        </button>

        {#if filterDropdownOpen}
          <div class="fixed inset-0 z-40" onclick={() => filterDropdownOpen = false} role="presentation"></div>
          <div id="region-filter-dropdown" class="absolute right-0 top-full mt-2 z-50 bg-[#111113] border border-gray-700 rounded-lg p-3 w-80 shadow-xl">
            <div class="flex items-center justify-between mb-2.5">
              <span class="text-[10px] text-gray-600 uppercase tracking-widest">Regions</span>
              <div class="flex gap-1">
                <button onclick={selectAll} class="text-xs text-gray-400 hover:text-white px-2 py-0.5 transition-colors">All</button>
                <button onclick={clearAll} class="text-xs text-gray-400 hover:text-white px-2 py-0.5 transition-colors">None</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-1.5">
              {#each ALL_REGIONS as region}
                <button
                  onclick={() => toggleRegion(region)}
                  class="text-xs px-2 py-0.5 rounded font-medium transition-opacity cursor-pointer {REGION_COLORS[region]} {activeRegions.has(region) ? 'opacity-100' : 'opacity-30'}"
                >
                  {region}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <a
        href="{base}/about"
        class="text-xs text-gray-600 hover:text-gray-300 transition-colors"
      >
        About
      </a>

      <a
        href="https://github.com/noahsabaj/ww3watch"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub repository"
        class="text-gray-600 hover:text-gray-300 transition-colors"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.5 11.5 0 0 1 12 6.803c.98.005 1.967.138 2.888.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
        </svg>
      </a>
    </div>
  </div>
</header>
