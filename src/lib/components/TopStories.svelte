<script lang="ts">
  import type { Cluster } from '$lib/cluster'

  let { stories }: { stories: Cluster[] } = $props()
  let open = $state(true)
</script>

{#if stories.length > 0}
  <div class="border-b border-gray-800 bg-[#0a0a0b]">
    <div class="max-w-3xl mx-auto px-4">
      <button
        onclick={() => open = !open}
        class="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-gray-600 hover:text-gray-400 transition-colors pt-3 pb-2 w-full text-left"
      >
        <span class="inline-block transition-transform {open ? '' : '-rotate-90'}">▾</span>
        Trending Now
      </button>
      {#if open}
        <ol class="pb-3 pl-4">
          {#each stories as cluster, i (cluster.id)}
            {@const rep = cluster.representative}
            <li class="border-t border-gray-800/40 first:border-t-0">
              <a
                href={rep.url}
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-baseline gap-2.5 py-2 group"
              >
                <span class="text-xs text-gray-500 font-mono w-3 shrink-0 text-right">{i + 1}</span>
                <span class="flex-1 text-sm text-gray-200 group-hover:text-white transition-colors leading-snug line-clamp-2">
                  {rep.title}<span class="text-gray-600 font-normal"> · {cluster.sourceCount} sources</span>
                </span>
              </a>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </div>
{/if}
