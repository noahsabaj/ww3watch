<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import { timeAgo } from '$lib/utils'
  import RegionBadge from '$lib/components/RegionBadge.svelte'

  let { stories, onselect }: { stories: Cluster[], onselect: (a: Article) => void } = $props()
  let open = $state(true)
  let expandedIds = $state(new Set<string>())

  function toggleExpanded(id: string) {
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expandedIds = next
  }
</script>

{#if stories.length > 0}
  <div class="border-b border-gray-800 bg-[#0a0a0b] px-4">
    <div class="max-w-3xl mx-auto">
      <button
        onclick={() => open = !open}
        class="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-gray-600 hover:text-gray-400 transition-colors pt-3 pb-2 w-full text-left"
      >
        <span class="inline-block transition-transform {open ? '' : '-rotate-90'}">▾</span>
        Trending Now
      </button>
      {#if open}
        <ol class="pb-2">
          {#each stories as cluster, i (cluster.id)}
            {@const rep = cluster.representative}
            {@const isExpanded = expandedIds.has(cluster.id)}
            <li class="border-t border-gray-800/40 first:border-t-0 py-1">
              <div class="flex items-baseline gap-2">
                <span class="text-xs text-gray-500 font-mono shrink-0">{i + 1}</span>
                <div class="flex-1 min-w-0">
                  <button
                    onclick={() => onselect(rep)}
                    class="text-sm text-gray-200 hover:text-white transition-colors leading-snug text-left"
                  >
                    {rep.title}
                  </button>
                  {#if cluster.sourceCount > 1}
                    <button
                      onclick={() => toggleExpanded(cluster.id)}
                      class="text-xs text-gray-600 hover:text-gray-400 transition-colors ml-1.5"
                    >
                      · {cluster.sourceCount} sources
                    </button>
                  {:else}
                    <span class="text-xs text-gray-600 ml-1.5">· 1 source</span>
                  {/if}

                  {#if isExpanded}
                    <div class="mt-1.5 space-y-0.5 border-t border-gray-800/40 pt-1.5">
                      {#each cluster.articles as article (article.id)}
                        <div class="flex items-center gap-2 py-0.5">
                          <RegionBadge region={article.source_region} size="sm" />
                          <span class="text-xs text-gray-500 shrink-0">{article.source_name}</span>
                          <button
                            onclick={() => onselect(article)}
                            class="text-xs text-gray-300 hover:text-blue-400 transition-colors line-clamp-1 flex-1 min-w-0 text-left"
                          >
                            {article.title}
                          </button>
                          <span class="text-xs text-gray-600 shrink-0">{timeAgo(article.published_at)}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </div>
{/if}
