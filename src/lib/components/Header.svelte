<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { ALL_REGIONS, REGION_COLORS } from '$lib/types'
  import { timeAgo, LANG_NAMES } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import { base } from '$app/paths'
  import SignalFilters from '$lib/components/SignalFilters.svelte'
  import { signalFilterActive, type Actor, type SignalFilter, type Topic } from '$lib/signals'

  let {
    searchQuery = $bindable(),
    activeRegions = $bindable(),
    excludedLangs = $bindable(),
    availableLangs,
    signalFilter = $bindable(),
    availableTopics,
    availableActors,
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
    excludedLangs: Set<string>
    availableLangs: { lang: string; count: number }[]
    signalFilter: SignalFilter
    availableTopics: { key: Topic; count: number }[]
    availableActors: { key: Actor; count: number }[]
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
  function toggleLang(lang: string) {
    const next = new Set(excludedLangs)
    if (next.has(lang)) next.delete(lang)
    else next.add(lang)
    excludedLangs = next
  }
  const filterActive = $derived(activeRegions.size < ALL_REGIONS.length || excludedLangs.size > 0 || signalFilterActive(signalFilter))

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
  <div class="max-w-3xl mx-auto flex flex-wrap items-center gap-3">
    <!-- Brand -->
    <div class="flex items-center gap-3 shrink-0">
      <h1 class="text-white font-bold text-lg tracking-tight">WW3Watch</h1>
    </div>

    <!-- Search input (desktop only) -->
    <input
      type="text"
      aria-label="Search headlines"
      placeholder="Search headlines..."
      bind:value={searchQuery}
      class="hidden md:block flex-1 min-w-0 bg-[#18181b] border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
    />

    <!-- Right actions -->
    <div class="flex flex-wrap items-center gap-2 ml-auto md:ml-0 min-w-0">
      <span
        class="hidden sm:flex flex-wrap items-center gap-1.5 text-xs text-gray-400"
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
            title="Ingestion last completed {new Date(lastUpdatedAt).toLocaleString()} — runs about every 15 min{staleness === 'red' ? '. The pipeline appears to be down.' : staleness === 'amber' ? '. Several runs appear to have been missed.' : ''}"
          >
            · updated {timeAgo(lastUpdatedAt, clock.now)}
          </span>
        {/if}
      </span>

      <!-- Region filter button + dropdown (desktop only) -->
      <div class="relative hidden md:block">
        <button
          onclick={() => filterDropdownOpen = !filterDropdownOpen}
          aria-label="Filter by region, language, topic and parties involved"
          aria-haspopup="true"
          aria-expanded={filterDropdownOpen}
          aria-controls="region-filter-dropdown"
          class="flex items-center justify-center w-7 h-7 rounded transition-colors {filterDropdownOpen || filterActive ? 'text-blue-400' : 'text-gray-600 hover:text-gray-300'}"
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
          <div id="region-filter-dropdown" class="absolute right-0 top-full mt-2 z-50 bg-[#111113] border border-gray-700 rounded-lg p-3 w-80 shadow-xl max-h-[80vh] overflow-y-auto">
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
            <!-- Language chips: exclusion toggles over whatever the loaded feed
                 contains (nearly half of it is non-English). -->
            <div class="mt-3 mb-2 text-[10px] text-gray-600 uppercase tracking-widest">Languages</div>
            <div class="flex flex-wrap gap-1.5">
              {#each availableLangs as { lang, count } (lang)}
                <button
                  onclick={() => toggleLang(lang)}
                  aria-pressed={!excludedLangs.has(lang)}
                  title="{LANG_NAMES[lang] ?? lang} · {count} {count === 1 ? 'article' : 'articles'}"
                  class="text-xs px-2 py-0.5 rounded font-medium transition-opacity cursor-pointer bg-gray-800 text-gray-200 border border-gray-700 {excludedLangs.has(lang) ? 'opacity-30' : 'opacity-100'}"
                >
                  {LANG_NAMES[lang] ?? lang.toUpperCase()}
                </button>
              {/each}
            </div>
            <SignalFilters bind:filter={signalFilter} {availableTopics} {availableActors} />
          </div>
        {/if}
      </div>

      <details class="relative">
        <summary class="min-h-11 min-w-11 flex items-center px-3 cursor-pointer text-sm text-gray-300">Menu</summary>
        <nav aria-label="Site navigation" class="absolute right-0 top-full w-56 rounded border border-gray-700 bg-[#111113] p-2 shadow-xl">
          {#each [['/trends', 'Trends'], ['/about', 'About'], ['/privacy', 'Privacy'], ['/feedback', 'Feedback & corrections']] as [path, label]}
            <a href="{base}{path}" class="flex min-h-11 items-center px-3 text-sm text-gray-200 hover:bg-gray-800">{label}</a>
          {/each}
          <a href="https://github.com/noahsabaj/ww3watch" target="_blank" rel="noopener noreferrer" class="flex min-h-11 items-center px-3 text-sm text-gray-200">GitHub repository ↗</a>
        </nav>
      </details>
    </div>
  </div>
  <p class="sm:hidden max-w-3xl mx-auto text-xs text-gray-400 mt-1">{storyCount} stories{#if lastUpdatedAt} · updated {timeAgo(lastUpdatedAt, clock.now)}{/if}</p>
</header>
