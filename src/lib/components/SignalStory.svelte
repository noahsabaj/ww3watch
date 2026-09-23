<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import type { Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import { REGION_COLORS } from '$lib/types'
  import { headlineText, langTag, timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import { regionWash } from '$lib/region-wash'
  import { createHeadlineTranslation } from '$lib/headline-translation.svelte'
  import { createStoryPhoto } from '$lib/story-photo.svelte'
  import ShareControls from '$lib/components/ShareControls.svelte'
  import SignalBadges from '$lib/components/SignalBadges.svelte'
  import { storyBadgeSignals } from '$lib/story'
  import TheaterTag from '$lib/components/TheaterTag.svelte'

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
  const others = $derived(cluster.articles.filter((a) => a.id !== rep.id).slice(0, 3))
  const badgeSignals = $derived(storyBadgeSignals(cluster))
  const repLang = $derived(langTag(rep.source_lang))
  const translation = createHeadlineTranslation(() => rep)
  const photo = createStoryPhoto(() => cluster, 360)
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
      <img
        src={photo.shown.url}
        alt=""
        class="absolute inset-0 h-full w-full object-cover"
        referrerpolicy="no-referrer"
        decoding="async"
        onerror={photo.fail}
        onload={photo.loaded}
      />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#070809] to-transparent"></div>
    </div>
  {:else}
    <div class="signal-grain absolute inset-0"></div>
  {/if}
  <!-- Bottom padding clears the home indicator. -->
  <div
    class="relative flex shrink-0 flex-col justify-end px-5 {photo.shown ? 'bg-ink pt-4' : 'h-full pt-6'}"
    style="padding-bottom: calc(1.75rem + env(safe-area-inset-bottom, 0px))"
  >
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <TheaterTag {cluster} onpick={ontheater} />
      <span class="text-[11px] font-medium uppercase tracking-[0.16em] text-fg-2">{rep.source_region} outlet</span>
      {#if repLang}
        <span class="text-[9px] font-mono uppercase tracking-wide text-fg-3 border border-line rounded px-1">{repLang}</span>
      {/if}
      <SignalBadges article={badgeSignals} />
      {#if translation.shown}
        <span class="text-[10px] font-medium uppercase tracking-[0.12em] text-fg-3">Translated</span>
      {/if}
    </div>

    <a
      href={rep.url}
      target="_blank"
      rel="noopener noreferrer"
      dir={translation.dir}
      class="font-serif text-[2rem] leading-[1.12] font-medium tracking-tight text-fg hover:text-fg"
      onclick={(e) => {
        if (onselect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          e.preventDefault()
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
    {/if}

    {#if others.length > 0}
      <ul class="mt-4 space-y-1.5">
        {#each others as article (article.id)}
          <li class="flex items-center gap-2 text-sm text-fg-2 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0 {REGION_COLORS[article.source_region]?.split(' ')[0] ?? 'bg-gray-500'}"></span>
            <span class="truncate text-fg-2" dir="auto">
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
    {#if cluster.sourceCount > 1}
      <p class="mt-3 text-xs text-fg-3">Tap the headline to read it and every other newsroom's version.</p>
    {/if}
    {#if hint}
      <p data-swipe-hint class="swipe-hint mt-5 flex items-center justify-center gap-1.5 text-xs text-fg-2">
        <Icon name="arrow-up" size={14} />Swipe up for the next story
      </p>
    {/if}
  </div>
</article>
