<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { REGION_COLORS, ALL_REGIONS } from '$lib/types'
  import { LANG_NAMES } from '$lib/utils'
  import SignalFilters from '$lib/components/SignalFilters.svelte'
  import type { Actor, SignalFilter, Topic } from '$lib/signals'
  import type { SortMode } from '$lib/filters.svelte'

  let {
    open = $bindable(),
    activeRegions = $bindable(),
    excludedLangs = $bindable(),
    availableLangs,
    searchQuery = $bindable(),
    signalFilter = $bindable(),
    availableTopics,
    availableActors,
    sortMode,
    onSortMode,
  }: {
    open: boolean
    activeRegions: Set<SourceRegion>
    excludedLangs: Set<string>
    availableLangs: { lang: string; count: number }[]
    signalFilter: SignalFilter
    availableTopics: { key: Topic; count: number }[]
    availableActors: { key: Actor; count: number }[]
    searchQuery: string
    sortMode: SortMode
    onSortMode: (mode: SortMode) => void
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

  // Focus the sheet itself on open (NOT the search input — that pops the mobile
  // keyboard over a sheet most users open for the region chips); restore after.
  let sheetEl = $state<HTMLElement | null>(null)
  let previouslyFocused: Element | null = null
  let wasOpen = false
  $effect(() => {
    if (open && !wasOpen) {
      previouslyFocused = document.activeElement
      sheetEl?.focus()
    } else if (!open && wasOpen) {
      const el = previouslyFocused as HTMLElement | null
      if (el?.isConnected && typeof el.focus === 'function') el.focus()
      previouslyFocused = null
    }
    wasOpen = open
  })

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); open = false }
    if (e.key === 'Tab' && sheetEl) {
      const controls = [...sheetEl.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex="0"]')].filter(el => !el.hasAttribute('disabled'))
      const first = controls[0], last = controls.at(-1)
      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetEl)) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === sheetEl)) { e.preventDefault(); first?.focus() }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/60 z-60 min-[820px]:hidden"
    onclick={() => open = false}
    role="presentation"
  ></div>

  <!-- Sheet -->
  <div
    bind:this={sheetEl}
    role="dialog"
    aria-modal="true"
    aria-label="Search, region, language and topic filters"
    tabindex="-1"
    class="fixed bottom-0 left-0 right-0 z-70 bg-[#111113] rounded-t-2xl border-t border-gray-800 min-[820px]:hidden max-h-[85vh] overflow-y-auto"
    style="padding-bottom: env(safe-area-inset-bottom, 0px)"
  >
    <!-- Drag handle -->
    <div class="flex justify-center pt-3 pb-1">
      <div class="w-10 h-1 rounded-full bg-gray-700"></div>
    </div>

    <div class="px-4 pt-2 pb-5 space-y-3">
      <div class="flex justify-between items-center"><h2 class="font-semibold">Filters</h2><button class="min-h-11 min-w-11 px-3" onclick={() => open = false}>Close</button></div>
      <div class="flex items-center gap-2" role="group" aria-label="Feed order">
        {#each [['latest', 'Latest'], ['top', 'Top · 24h']] as [mode, label] (mode)}
          <button
            onclick={() => onSortMode(mode as SortMode)}
            aria-pressed={sortMode === mode}
            class="text-sm px-4 rounded-full border transition-colors {sortMode === mode ? 'border-blue-500/50 bg-blue-600/15 text-blue-300' : 'border-gray-700 text-gray-400'}"
          >{label}</button>
        {/each}
      </div>
      <label for="mobile-search" class="block text-sm text-gray-300">Search headlines</label>
      <!-- Search + All/None -->
      <div class="flex items-center gap-2">
        <input
          id="mobile-search"
          type="text"
          placeholder="Search headlines..."
          bind:value={searchQuery}
          class="flex-1 min-w-0 bg-[#18181b] border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button onclick={selectAll} class="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors">All</button>
        <button onclick={clearAll} class="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors">None</button>
      </div>

      <!-- Region toggles -->
      <div class="flex flex-wrap gap-1.5">
        {#each ALL_REGIONS as region}
          <button
            onclick={() => toggleRegion(region)}
            class="text-xs px-2 py-1 rounded font-medium transition-opacity cursor-pointer {REGION_COLORS[region]} {activeRegions.has(region) ? 'opacity-100' : 'opacity-30'}"
          >
            {region}
          </button>
        {/each}
      </div>

      <!-- Language toggles -->
      <div class="text-[10px] text-gray-600 uppercase tracking-widest">Languages</div>
      <div class="flex flex-wrap gap-1.5">
        {#each availableLangs as { lang, count } (lang)}
          <button
            onclick={() => toggleLang(lang)}
            aria-pressed={!excludedLangs.has(lang)}
            title="{LANG_NAMES[lang] ?? lang} · {count} {count === 1 ? 'article' : 'articles'}"
            class="text-xs px-2 py-1 rounded font-medium transition-opacity cursor-pointer bg-gray-800 text-gray-200 border border-gray-700 {excludedLangs.has(lang) ? 'opacity-30' : 'opacity-100'}"
          >
            {LANG_NAMES[lang] ?? lang.toUpperCase()}
          </button>
        {/each}
      </div>
      <SignalFilters bind:filter={signalFilter} {availableTopics} {availableActors} size="md" />
    </div>
  </div>
{/if}

<style>button { min-height: 44px; min-width: 44px; }</style>
