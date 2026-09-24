<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import type { Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import { REGION_COLORS } from '$lib/types'
  import { headlineText, plainClick, timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import { regionWash } from '$lib/region-wash'
  import { createHeadlineTranslation } from '$lib/headline-translation.svelte'
  import { createStoryPhoto } from '$lib/story-photo.svelte'
  import ShareControls from '$lib/components/ShareControls.svelte'
  import StoryKicker from '$lib/components/StoryKicker.svelte'
  import StoryPhotoImg from '$lib/components/StoryPhotoImg.svelte'
  import { tips } from '$lib/tips.svelte'
  import { byOutlet } from '$lib/story'

  let {
    cluster,
    onselect,
    ontheater,
    hint = false,
  }: {
    cluster: Cluster
    onselect?: (a: Article) => void
    /** Narrow the feed to this story's theater; absent once it is narrowed. */
    ontheater?: (id: string) => void
    hint?: boolean
  } = $props()

  const rep = $derived(cluster.representative)
  // Up to three other newsrooms, one line each: an outlet that filed the story
  // ten times still gets one line, and the headline's own outlet none.
  const others = $derived(
    byOutlet(cluster.articles.filter((a) => a.source_name !== rep.source_name), 'newest').slice(0, 3).map((r) => r.lead),
  )
  const translation = createHeadlineTranslation(() => rep)
  const photo = createStoryPhoto(() => cluster, 360)
  $effect(tips.load)
</script>

<article
  data-signal-story
  data-story={cluster.id}
  data-photo={photo.shown ? '1' : undefined}
  class="signal-story relative flex h-full snap-start flex-col overflow-hidden"
  style="--wash: {regionWash(rep.source_region)}"
>
  <!-- A photograph gets the top of the screen to itself and the story sits
       below it on the dark ground, never on top of it: newsroom images often
       carry their own lettering (share cards, captions, banners) and two sets
       of words on one surface are unreadable. -->
  {#if photo.shown}
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <StoryPhotoImg {photo} class="absolute inset-0 h-full w-full object-cover" />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#070809] to-transparent"></div>
    </div>
  {:else}
    <!-- Without a photo the story sits in the middle of the screen with the
         outlet's summary under the headline, and a thin bar in the region's
         colour marks the top edge. Started at the top (#160) it left the
         bottom half empty: its text fills about half a phone screen (a median
         54% on 2026-09-23). On a phone tall enough the type is a size larger
         and the other outlets' headlines are shown whole, not cut to a line. -->
    <div class="signal-grain absolute inset-0"></div>
    <div class="absolute inset-x-0 top-0 h-0.5 {REGION_COLORS[rep.source_region]?.split(' ')[0] ?? 'bg-gray-500'}"></div>
  {/if}
  <!-- Bottom padding clears the home indicator. -->
  <div
    class="relative flex shrink-0 flex-col px-5 {photo.shown ? 'justify-end bg-ink pt-4' : 'h-full pt-6'}"
    style="padding-bottom: calc(1.75rem + env(safe-area-inset-bottom, 0px))"
  >
    <!-- Equal space above and below centres a story that has no photo. -->
    {#if !photo.shown}<div class="flex-1"></div>{/if}
    <StoryKicker {cluster} translated={!!translation.shown} {ontheater} class="mb-3" />

    <a
      href={rep.url}
      target="_blank"
      rel="noopener noreferrer"
      dir={translation.dir}
      class="font-serif text-[2rem] leading-[1.12] {photo.shown ? '' : 'tall:text-[2.25rem] tall:leading-[1.1]'} font-medium tracking-tight text-fg hover:text-fg"
      onclick={(e) => {
        if (onselect && plainClick(e)) {
          e.preventDefault()
          if (cluster.sourceCount > 1) tips.done('read-story')
          onselect(rep)
        }
      }}
    >
      {headlineText(translation.shown?.title ?? rep.title)}
    </a>

    <p class="mt-3 text-sm text-fg-2 tabular-nums">
      {rep.source_name}
      · {cluster.sourceCount} {cluster.sourceCount === 1 ? 'source' : 'sources'}
      · {timeAgo(rep.published_at, clock.now)}
    </p>
    {#if photo.shown}
      <p class="mt-1 text-[11px] uppercase tracking-[0.14em] text-fg-3">Photo · {photo.shown.sourceName}</p>
    {:else if translation.shown?.summary ?? rep.summary}
      <p data-story-summary dir={translation.dir} class="mt-4 shrink-0 text-[15px] leading-relaxed text-fg-2 line-clamp-5 tall:text-[17px] tall:line-clamp-6">
        {translation.shown?.summary ?? rep.summary}
      </p>
    {/if}

    {#if others.length > 0}
      <ul class="mt-4 space-y-1.5">
        {#each others as article (article.id)}
          <li class="flex {photo.shown ? 'items-center' : 'items-start'} gap-2 text-sm text-fg-2 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0 {photo.shown ? '' : 'mt-1.5'} {REGION_COLORS[article.source_region]?.split(' ')[0] ?? 'bg-gray-500'}"></span>
            <span class="truncate {photo.shown ? '' : 'tall:whitespace-normal tall:line-clamp-2'} text-fg-2" dir="auto">
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
          class="action min-h-9 gap-1.5 {translation.failed ? '!text-amber-400' : '!text-accent'}"
        ><Icon name="translate" size={15} />{translation.label}</button>
      {/if}
      <ShareControls article={rep} {cluster} />
    </div>
    {#if cluster.sourceCount > 1 && tips.shown('read-story')}
      <p data-read-tip class="mt-3 text-xs text-fg-3">Tap the headline to read it and every other newsroom's version.</p>
    {/if}
    {#if !photo.shown}<div class="flex-1"></div>{/if}
    {#if hint}
      <p data-swipe-hint class="swipe-hint {photo.shown ? 'mt-5' : 'pt-5'} flex items-center justify-center gap-1.5 text-xs text-fg-2">
        <Icon name="arrow-up" size={14} />Swipe up for the next story
      </p>
    {/if}
  </div>
</article>
