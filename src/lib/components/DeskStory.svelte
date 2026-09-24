<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import type { Cluster } from '$lib/cluster'
  import { storyTimeline, wireDuplicateIds } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import { REGION_BORDER } from '$lib/types'
  import { headlineText, langTag, offsetLabel, plainClick, timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import { regionWash } from '$lib/region-wash'
  import { createHeadlineTranslation } from '$lib/headline-translation.svelte'
  import { createStoryPhoto } from '$lib/story-photo.svelte'
  import { byOutlet, bySide, memberKind } from '$lib/story'
  import ShareControls from '$lib/components/ShareControls.svelte'
  import AffiliationBadge from '$lib/components/AffiliationBadge.svelte'
  import StoryKicker from '$lib/components/StoryKicker.svelte'
  import StoryPhotoImg from '$lib/components/StoryPhotoImg.svelte'
  import OutletFold from '$lib/components/OutletFold.svelte'
  import StoryEvidence from '$lib/components/StoryEvidence.svelte'

  // The desk's right pane: one story, Signal's treatment, with the thing a wide
  // screen has room for — every newsroom's headline side by side.
  let {
    cluster,
    onread,
    ontheater,
  }: {
    cluster: Cluster
    onread: (a: Article) => void
    /** Narrow the feed to this story's theater; absent once it is narrowed. */
    ontheater?: (id: string) => void
  } = $props()

  const rep = $derived(cluster.representative)
  const translation = createHeadlineTranslation(() => rep)
  const photo = createStoryPhoto(() => cluster, 640)
  const wireIds = $derived(wireDuplicateIds(cluster.articles))
  const timeline = $derived(storyTimeline(cluster.articles))
  const sides = $derived(bySide(cluster.articles))
  const timelineEntry = $derived(new Map(timeline.ordered.map((e) => [e.article.id, e])))
  const timelineRows = $derived(byOutlet(timeline.ordered.map((e) => e.article), 'first'))

  // "By side" is the point of the product; "Timeline" answers who had it first.
  let view = $state<'sides' | 'timeline'>('sides')
  const KIND_LABEL = { statement: 'statement', analysis: 'analysis' } as const

  function read(e: MouseEvent, a: Article) {
    // Plain click reads in the pane; modified clicks open the original.
    if (!plainClick(e)) return
    e.preventDefault()
    onread(a)
  }
</script>

{#snippet outlet(article: Article, lead: string, leadStrong: boolean)}
  {@const kind = memberKind(article)}
  <li class="border-l-2 {REGION_BORDER[article.source_region] ?? 'border-line-strong'} rounded-none bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
    <a href={article.url} target="_blank" rel="noopener noreferrer" class="block px-3 py-2.5" onclick={(e) => read(e, article)}>
      <span class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-fg-3">
        {#if lead}<span class="font-mono {leadStrong ? 'text-amber-400' : ''}">{lead}</span>{/if}
        <span class="text-fg-2">{article.source_name}</span>
        {#if langTag(article.source_lang)}<span class="font-mono uppercase">{langTag(article.source_lang)}</span>{/if}
        <AffiliationBadge affiliation={article.source_affiliation} />
        {#if wireIds.has(article.id)}
          <span class="uppercase tracking-wider text-fg-3" title="Near-identical to an earlier article in this story — likely syndicated wire copy">wire</span>
        {/if}
        {#if kind === 'statement' || kind === 'analysis'}
          <span class="uppercase tracking-wider text-fg-3">{KIND_LABEL[kind]}</span>
        {/if}
        <span class="ml-auto tabular-nums">{timeAgo(article.published_at, clock.now)}</span>
      </span>
      <span dir="auto" class="mt-1 block text-[15px] leading-snug text-fg line-clamp-3">{headlineText(article.title)}</span>
    </a>
  </li>
{/snippet}

<article
  data-desk-story-pane
  data-story={cluster.id}
  data-photo={photo.shown ? '1' : undefined}
  class="signal-story relative min-h-full"
  style="--wash: {regionWash(rep.source_region)}"
>
  <div class="signal-grain absolute inset-0"></div>
  <!-- A newsroom photograph heads the pane as its own band, and the story
       starts below it: images often carry their own lettering, so ours never
       sits on top of one. Without a photo the region wash carries the story. -->
  {#if photo.shown}
    <div class="relative h-[26rem] overflow-hidden">
      <StoryPhotoImg {photo} class="h-full w-full object-cover" />
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#070809] to-transparent"></div>
    </div>
  {/if}
  <div class="relative mx-auto max-w-4xl px-6 lg:px-10 pb-16 {photo.shown ? 'pt-6' : 'pt-14'}">
    <StoryKicker {cluster} translated={!!translation.shown} {ontheater} class="mb-4" />

    <h2 dir={translation.dir} class="font-serif text-[2rem] lg:text-[2.6rem] leading-[1.1] font-medium tracking-tight text-fg">
      <a href={rep.url} target="_blank" rel="noopener noreferrer" class="hover:text-fg" onclick={(e) => read(e, rep)}>
        {headlineText(translation.shown?.title ?? rep.title)}
      </a>
    </h2>

    <p class="mt-4 text-sm text-fg-2 tabular-nums">
      {rep.source_name}
      · {timeAgo(rep.published_at, clock.now)}
      {#if cluster.sourceCount > 1 && timeline.firstAt}
        · first reported {timeAgo(new Date(timeline.firstAt).toISOString(), clock.now)}
      {/if}
      {#if photo.shown}
        <span class="ml-2 text-[11px] uppercase tracking-[0.14em] text-fg-3">Photo · {photo.shown.sourceName}</span>
      {/if}
    </p>

    {#if (translation.shown?.summary ?? rep.summary)}
      <p dir={translation.dir} class="mt-5 max-w-3xl text-[17px] leading-relaxed text-fg-2 line-clamp-5">
        {translation.shown?.summary ?? rep.summary}
      </p>
    {/if}
    <StoryEvidence storyId={cluster.storyId} class="mt-5 max-w-3xl" />

    <div class="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <button
        type="button"
        onclick={() => onread(rep)}
        class="btn"
      >Read {rep.source_name}</button>
      {#if translation.available}
        <button
          type="button"
          onclick={translation.toggle}
          aria-busy={translation.busy}
          class="action gap-1.5 {translation.failed ? '!text-amber-400' : '!text-accent'}"
        ><Icon name="translate" size={15} />{translation.label}</button>
      {/if}
      <ShareControls article={rep} {cluster} />
    </div>

    {#if cluster.sourceCount > 1}
      <section class="mt-12" aria-labelledby="newsrooms-{cluster.id}">
        <div class="mb-4 flex flex-wrap items-baseline gap-3">
          <h3 id="newsrooms-{cluster.id}" class="font-serif text-xl text-fg">
            How {cluster.sourceCount} newsrooms put it
          </h3>
          <span class="text-xs text-fg-3">{timeline.regionCount} {timeline.regionCount === 1 ? 'region' : 'regions'}</span>
          <div class="ml-auto flex items-center gap-1" role="group" aria-label="Story view">
            {#each [['sides', 'By side'], ['timeline', 'Timeline']] as [v, label] (v)}
              <button
                type="button"
                onclick={() => (view = v as 'sides' | 'timeline')}
                aria-pressed={view === v}
                title={v === 'sides' ? 'The same story as each region’s outlets tell it; state media shown separately' : 'Who reported first, and how coverage unfolded'}
                class="pill min-h-8 px-3 text-xs"
              >{label}</button>
            {/each}
          </div>
        </div>

        {#if view === 'sides'}
          <div class="space-y-6">
            {#each sides as side (side.region + (side.affiliation ?? ''))}
              {@const rows = byOutlet(side.articles, 'newest')}
              <div>
                <p class="mb-2 text-[11px] uppercase tracking-[0.14em] text-fg-3">
                  {side.region}{side.affiliation === 'state' ? ' · state media' : ''} <span class="text-fg-3">· {rows.length}</span>
                </p>
                <ul class="grid gap-2 xl:grid-cols-2">
                  {#each rows as row (row.lead.id)}
                    <OutletFold {row} class="xl:col-span-2">
                      {#snippet item(article)}{@render outlet(article, '', false)}{/snippet}
                    </OutletFold>
                  {/each}
                </ul>
              </div>
            {/each}
          </div>
        {:else}
          <ul class="grid gap-2">
            {#each timelineRows as row (row.lead.id)}
              <OutletFold {row}>
                {#snippet item(article)}
                  {@const entry = timelineEntry.get(article.id)!}
                  {@render outlet(article, entry.isFirst ? 'FIRST' : entry.offsetMs !== null ? offsetLabel(entry.offsetMs) : '', entry.isFirst)}
                {/snippet}
              </OutletFold>
            {/each}
          </ul>
        {/if}
      </section>
    {:else}
      <p class="mt-12 text-sm text-fg-3">Only {rep.source_name} has reported this so far. Other newsrooms join the story here as they cover it.</p>
    {/if}
  </div>
</article>
