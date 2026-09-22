<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { ALL_REGIONS, REGION_COLORS } from '$lib/types'
  import { LANG_NAMES } from '$lib/utils'
  import { ACTORS, TOPICS, type Actor, type SignalFilter, type Topic } from '$lib/signals'
  import type { SortMode } from '$lib/filters.svelte'

  // Every way to narrow the feed, in one place: the phone's filter sheet and
  // the desk's filter panel render exactly this. Regions carry their colour as
  // a dot; a lit outline marks what is on.
  let {
    activeRegions = $bindable(),
    excludedLangs = $bindable(),
    searchQuery = $bindable(),
    signalFilter = $bindable(),
    availableLangs,
    availableTopics,
    availableActors,
    sortMode,
    onSortMode,
    showSearch = false,
  }: {
    activeRegions: Set<SourceRegion>
    excludedLangs: Set<string>
    searchQuery: string
    signalFilter: SignalFilter
    availableLangs: { lang: string; count: number }[]
    availableTopics: { key: Topic; count: number }[]
    availableActors: { key: Actor; count: number }[]
    sortMode: SortMode
    onSortMode: (mode: SortMode) => void
    showSearch?: boolean
  } = $props()

  function toggleRegion(region: SourceRegion) {
    const next = new Set(activeRegions)
    if (next.has(region)) next.delete(region)
    else next.add(region)
    activeRegions = next
  }
  function toggleLang(lang: string) {
    const next = new Set(excludedLangs)
    if (next.has(lang)) next.delete(lang)
    else next.add(lang)
    excludedLangs = next
  }
  function toggleSignal(k: 'majorOnly' | 'hideOpinion' | 'hideClaims') {
    signalFilter = { ...signalFilter, [k]: !signalFilter[k] }
  }
  function toggleIn<K>(set: Set<K>, key: K): Set<K> {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  const dot = (region: SourceRegion) => REGION_COLORS[region]?.split(' ')[0] ?? 'bg-gray-500'
  const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`
</script>

<div class="space-y-6 pt-3">
  <section>
    <h3 class="label mb-2.5">Order</h3>
    <div class="flex gap-2" role="group" aria-label="Feed order">
      {#each [['latest', 'Latest'], ['top', 'Top · 24h']] as [mode, label] (mode)}
        <button
          type="button"
          class="pill"
          aria-pressed={sortMode === mode}
          title={mode === 'top' ? 'The last 24 hours, ranked by severity, independent corroboration and recency' : 'Newest first'}
          onclick={() => onSortMode(mode as SortMode)}
        >{label}</button>
      {/each}
    </div>
  </section>

  {#if showSearch}
    <!-- The desk has search in its header; the panel's copy is for phones. -->
    <section class="min-[820px]:hidden">
      <label for="filter-search" class="label mb-2.5 block">Search headlines</label>
      <input id="filter-search" type="search" class="field" placeholder="A place, a name, a word…" bind:value={searchQuery} />
    </section>
  {/if}

  <section>
    <div class="mb-2.5 flex items-center justify-between">
      <h3 class="label">Regions</h3>
      <div class="flex gap-1 text-xs">
        <button type="button" class="action min-h-8 px-2" onclick={() => (activeRegions = new Set(ALL_REGIONS))}>All</button>
        <button type="button" class="action min-h-8 px-2" onclick={() => (activeRegions = new Set())}>None</button>
      </div>
    </div>
    <div class="flex flex-wrap gap-2">
      {#each ALL_REGIONS as region (region)}
        <button type="button" class="pill" aria-pressed={activeRegions.has(region)} onclick={() => toggleRegion(region)}>
          <span class="h-2 w-2 rounded-full {dot(region)} {activeRegions.has(region) ? '' : 'opacity-30'}" aria-hidden="true"></span>
          {region}
        </button>
      {/each}
    </div>
  </section>

  {#if availableLangs.length > 0}
    <section>
      <h3 class="label mb-2.5">Languages</h3>
      <div class="flex flex-wrap gap-2">
        {#each availableLangs as { lang, count } (lang)}
          <button
            type="button"
            class="pill"
            aria-pressed={!excludedLangs.has(lang)}
            title="{LANG_NAMES[lang] ?? lang} · {plural(count, 'article')}"
            onclick={() => toggleLang(lang)}
          >{LANG_NAMES[lang] ?? lang.toUpperCase()}</button>
        {/each}
      </div>
    </section>
  {/if}

  <section>
    <h3 class="label mb-2.5">Show</h3>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="pill" aria-pressed={signalFilter.majorOnly} onclick={() => toggleSignal('majorOnly')} title="Only significant events: deadly attacks, major offensives, state-level escalation">Major only</button>
      <button type="button" class="pill" aria-pressed={signalFilter.hideClaims} onclick={() => toggleSignal('hideClaims')} title="Hide threats, claims and denials; keep things that happened">Hide statements</button>
      <button type="button" class="pill" aria-pressed={signalFilter.hideOpinion} onclick={() => toggleSignal('hideOpinion')} title="Hide opinion, analysis and explainers">Hide analysis</button>
    </div>
  </section>

  {#if availableTopics.length > 0}
    <section>
      <h3 class="label mb-2.5">Topic</h3>
      <div class="flex flex-wrap gap-2">
        {#each availableTopics as { key, count } (key)}
          <button
            type="button"
            class="pill"
            aria-pressed={signalFilter.topics.has(key)}
            title={plural(count, 'article')}
            onclick={() => (signalFilter = { ...signalFilter, topics: toggleIn(signalFilter.topics, key) })}
          >{TOPICS[key].label}</button>
        {/each}
      </div>
    </section>
  {/if}

  {#if availableActors.length > 0}
    <section>
      <h3 class="label mb-2.5">Involving</h3>
      <div class="flex flex-wrap gap-2">
        {#each availableActors as { key, count } (key)}
          <button
            type="button"
            class="pill"
            aria-pressed={signalFilter.actors.has(key)}
            title={plural(count, 'article')}
            onclick={() => (signalFilter = { ...signalFilter, actors: toggleIn(signalFilter.actors, key) })}
          >{ACTORS[key].label}</button>
        {/each}
      </div>
    </section>
  {/if}
</div>
