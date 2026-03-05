<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { REGION_COLORS } from '$lib/types'

  let { region, size = 'md' }: { region: SourceRegion; size?: 'sm' | 'md' } = $props()
</script>

<span class="text-xs font-semibold rounded {REGION_COLORS[region]} {size === 'sm' ? 'px-1.5 py-0.5 shrink-0' : 'px-2 py-0.5'}">
  {region}
</span>
