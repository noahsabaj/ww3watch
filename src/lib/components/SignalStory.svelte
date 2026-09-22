<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import { REGION_COLORS } from '$lib/types'
  import { headlineText, langTag, timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import { regionWash } from '$lib/region-wash'
  import { createHeadlineTranslation } from '$lib/headline-translation.svelte'
  import ShareControls from '$lib/components/ShareControls.svelte'
  import SignalBadges from '$lib/components/SignalBadges.svelte'
  import { storyBadgeSignals } from '$lib/story'

  let { cluster, onselect }: { cluster: Cluster; onselect?: (a: Article) => void } = $props()

  const rep = $derived(cluster.representative)
  const others = $derived(cluster.articles.filter((a) => a.id !== rep.id).slice(0, 3))
  const badgeSignals = $derived(storyBadgeSignals(cluster))
  const repLang = $derived(langTag(rep.source_lang))
  const translation = createHeadlineTranslation(() => rep)
</script>

<article
  data-signal-story
  data-story={cluster.id}
  class="signal-story relative h-full snap-start overflow-hidden"
  style="--wash: {regionWash(rep.source_region)}"
>
  <div class="signal-grain absolute inset-0"></div>
  <!-- Bottom padding clears the floating filter button and the home indicator. -->
  <div
    class="relative flex h-full flex-col justify-end px-5 pt-6"
    style="padding-bottom: calc(6rem + env(safe-area-inset-bottom, 0px))"
  >
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <span class="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">{rep.source_region}</span>
      {#if repLang}
        <span class="text-[9px] font-mono uppercase tracking-wide text-gray-500 border border-gray-700/60 rounded px-1">{repLang}</span>
      {/if}
      <SignalBadges article={badgeSignals} />
      {#if translation.shown}
        <span class="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">Translated</span>
      {/if}
    </div>

    <a
      href={rep.url}
      target="_blank"
      rel="noopener noreferrer"
      dir={translation.dir}
      class="font-serif text-[2rem] leading-[1.12] font-medium tracking-tight text-white hover:text-blue-200"
      onclick={(e) => {
        if (onselect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          e.preventDefault()
          onselect(rep)
        }
      }}
    >
      {headlineText(translation.shown?.title ?? rep.title)}
    </a>

    <p class="mt-3 text-sm text-gray-400 tabular-nums">
      {rep.source_name}
      · {cluster.sourceCount} {cluster.sourceCount === 1 ? 'source' : 'sources'}
      · {timeAgo(rep.published_at, clock.now)}
    </p>

    {#if others.length > 0}
      <ul class="mt-4 space-y-1.5">
        {#each others as article (article.id)}
          <li class="flex items-center gap-2 text-sm text-gray-300 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0 {REGION_COLORS[article.source_region]?.split(' ')[0] ?? 'bg-gray-500'}"></span>
            <span class="truncate text-gray-400" dir="auto">
              {article.source_name} · {headlineText(article.title)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {#if translation.available}
        <button
          type="button"
          onclick={translation.toggle}
          aria-busy={translation.busy}
          class="transition-colors {translation.failed ? 'text-amber-400 hover:text-amber-300' : 'text-blue-400 hover:text-blue-300'}"
        >{translation.label}</button>
      {/if}
      <ShareControls article={rep} {cluster} />
    </div>
    {#if cluster.sourceCount > 1}
      <p class="mt-3 text-xs text-gray-600">Tap the headline to read it and every other newsroom's version.</p>
    {/if}
  </div>
</article>
