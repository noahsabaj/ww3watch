<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { REGION_COLORS, ALL_REGIONS } from '$lib/types'

  let {
    open = $bindable(),
    activeRegions = $bindable(),
    searchQuery = $bindable(),
  }: {
    open: boolean
    activeRegions: Set<SourceRegion>
    searchQuery: string
  } = $props()

  function toggleRegion(region: SourceRegion) {
    const next = new Set(activeRegions)
    if (next.has(region)) next.delete(region)
    else next.add(region)
    activeRegions = next
  }

  function selectAll() { activeRegions = new Set(ALL_REGIONS) }
  function clearAll() { activeRegions = new Set() }
</script>

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/60 z-60 md:hidden"
    onclick={() => open = false}
    role="presentation"
  ></div>

  <!-- Sheet -->
  <div
    class="fixed bottom-0 left-0 right-0 z-70 bg-[#111113] rounded-t-2xl border-t border-gray-800 md:hidden"
    style="padding-bottom: env(safe-area-inset-bottom, 0px)"
  >
    <!-- Drag handle -->
    <div class="flex justify-center pt-3 pb-1">
      <div class="w-10 h-1 rounded-full bg-gray-700"></div>
    </div>

    <div class="px-4 pt-2 pb-5 space-y-3">
      <!-- Search + All/None -->
      <div class="flex items-center gap-2">
        <input
          type="text"
          placeholder="Search headlines..."
          bind:value={searchQuery}
          class="flex-1 bg-[#18181b] border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
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
    </div>
  </div>
{/if}
