<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { REGION_COLORS } from '$lib/types'

  // A region is a coloured dot and its name, never a filled block: colour
  // stays a cue, not the loudest thing on the line.
  let { region, size = 'md' }: { region: SourceRegion; size?: 'sm' | 'md' } = $props()
</script>

<!-- Fallback colour covers the brief post-deploy window where an article still
     carries a pre-consolidation region value not in the REGIONS map. -->
<span class="inline-flex shrink-0 items-center gap-1.5 {size === 'sm' ? 'text-[11px]' : 'text-xs'} text-fg-2">
  <span class="h-2 w-2 rounded-full {REGION_COLORS[region]?.split(' ')[0] ?? 'bg-gray-500'}" aria-hidden="true"></span>
  {region}
</span>
