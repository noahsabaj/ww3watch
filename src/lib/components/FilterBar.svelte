<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { REGION_COLORS, ALL_REGIONS } from '$lib/types'

  let {
    activeRegions = $bindable(),
    searchQuery = $bindable(),
  }: {
    activeRegions: Set<SourceRegion>
    searchQuery: string
  } = $props()

  function toggleRegion(region: SourceRegion) {
    const next = new Set(activeRegions)
    if (next.has(region)) {
      next.delete(region)
    } else {
      next.add(region)
    }
    activeRegions = next
  }

  function selectAll() { activeRegions = new Set(ALL_REGIONS) }
  function clearAll() { activeRegions = new Set() }
</script>

<div class="sticky top-0 z-10 bg-[#0a0a0b]/95 backdrop-blur border-b border-gray-800 px-4 py-3">
  <div class="max-w-3xl mx-auto space-y-2">
    <div class="flex items-center gap-2">
      <input
        type="text"
        placeholder="Search headlines..."
        bind:value={searchQuery}
        class="flex-1 bg-[#18181b] border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />
      <button onclick={selectAll} class="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors">All</button>
      <button onclick={clearAll} class="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors">None</button>
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
</div>
