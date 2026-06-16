<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { REGION_COLORS } from '$lib/types'

  let { region, size = 'md' }: { region: SourceRegion; size?: 'sm' | 'md' } = $props()
</script>

<!-- Fallback color covers the brief post-deploy window where an article still
     carries a pre-consolidation region value (e.g. 'Iranian State') not in the
     new REGIONS map, until the region backfill runs. -->
<span class="text-xs font-semibold rounded {REGION_COLORS[region] ?? 'bg-gray-600 text-white'} {size === 'sm' ? 'px-1.5 py-0.5 shrink-0' : 'px-2 py-0.5'}">
  {region}
</span>
