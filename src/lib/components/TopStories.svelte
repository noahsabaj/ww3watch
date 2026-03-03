<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import { REGION_COLORS, REGION_BORDER } from '$lib/types'
  import { timeAgo } from '$lib/utils'

  let { stories }: { stories: Cluster[] } = $props()
</script>

{#if stories.length > 0}
  <div class="border-b border-gray-800 bg-[#0a0a0b]">
    <div class="max-w-3xl mx-auto px-4 pt-3 pb-3">
      <p class="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Trending Now</p>
      <div class="flex gap-2 flex-wrap">
        {#each stories as cluster (cluster.id)}
          {@const rep = cluster.representative}
          <a
            href={rep.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={rep.title}
            class="flex-1 min-w-[180px] border-l-4 {REGION_BORDER[rep.source_region]} bg-[#0d0d0f] hover:bg-[#131315] transition-colors px-3 py-2.5"
          >
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <span class="text-xs font-semibold px-1.5 py-0.5 rounded {REGION_COLORS[rep.source_region]}">
                {rep.source_region}
              </span>
              <span class="text-xs text-gray-600">{timeAgo(rep.published_at)}</span>
            </div>
            <p class="text-sm font-semibold text-white leading-snug line-clamp-2 mb-2">
              {rep.title}
            </p>
            <p class="text-xs text-gray-500">{cluster.sourceCount} {cluster.sourceCount === 1 ? 'source' : 'sources'}</p>
          </a>
        {/each}
      </div>
    </div>
  </div>
{/if}
