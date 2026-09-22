<script lang="ts">
  import { untrack } from 'svelte'
  import { storyImage, type Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import { REGION_COLORS } from '$lib/types'
  import { headlineText, isRtlLang, langTag, timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import { prefs } from '$lib/prefs.svelte'
  import {
    cachedHeadline, failureLabel, failureReason, translateHeadline,
    type HeadlineTranslation, type TranslateFailure,
  } from '$lib/translate'
  import ShareControls from '$lib/components/ShareControls.svelte'
  import SignalBadges from '$lib/components/SignalBadges.svelte'
  import { storySignals } from '$lib/story'

  const WASH: Record<string, string> = {
    'US/Western': '59, 99, 180',
    'UK': '80, 130, 190',
    'European': '90, 96, 170',
    'Israeli': '196, 112, 62',
    'Iranian': '150, 58, 58',
    'Arab/Gulf': '46, 128, 128',
    'Kurdish': '120, 80, 160',
    'Turkish': '160, 96, 80',
    'Russian': '160, 70, 80',
    'Ukrainian': '180, 150, 50',
    'Chinese': '170, 60, 60',
    'South Asian': '70, 140, 110',
    'East Asian': '50, 140, 150',
    'African': '90, 140, 80',
    'Independent/OSINT': '120, 118, 110',
  }

  let { cluster, onselect }: { cluster: Cluster; onselect?: (a: Article) => void } = $props()

  const rep = $derived(cluster.representative)
  const others = $derived(cluster.articles.filter((a) => a.id !== rep.id).slice(0, 3))
  const story = $derived(storySignals(cluster.articles))
  const badgeSignals = $derived(
    cluster.sourceCount === 1
      ? rep
      : {
          severity: story.topSeverity,
          unverified: story.unconfirmed ? 1 : 0,
          claim: story.talkOnly ? (rep.claim ?? 1) : 0,
          opinion: story.talkOnly ? (rep.opinion ?? 0) : 0,
        },
  )
  const wash = $derived(WASH[rep.source_region] ?? '110, 114, 128')
  const photo = $derived(storyImage(cluster))
  const canTranslate = $derived(rep.source_lang !== prefs.readingLang)
  let photoBroken = $state(false)
  $effect(() => {
    void photo?.url
    photoBroken = false
  })

  type HeadlineState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'done'; url: string; target: string; result: HeadlineTranslation }
    | { status: 'failed'; reason: TranslateFailure }
  let headline = $state<HeadlineState>({ status: 'idle' })
  let showTranslated = $state(false)

  const shown = $derived(
    showTranslated && headline.status === 'done' && headline.url === rep.url && headline.target === prefs.readingLang
      ? headline.result
      : null,
  )
  const titleText = $derived(shown ? shown.title : rep.title)
  const translatedDir = $derived(isRtlLang(prefs.readingLang) ? 'rtl' : 'ltr')
  const translateLabel = $derived(
    headline.status === 'loading' ? 'Translating…'
    : headline.status === 'failed' ? failureLabel(headline.reason)
    : shown ? 'Translated · show original'
    : 'Translate',
  )
  const repLang = $derived(langTag(rep.source_lang))

  $effect(() => {
    const target = prefs.readingLang
    const url = rep.url
    const hit = cachedHeadline(rep, target)
    if (!hit) return
    const current = untrack(() => headline)
    if (current.status === 'done' && current.url === url && current.target === target) return
    headline = { status: 'done', url, target, result: hit }
    showTranslated = true
  })

  async function translate() {
    if (headline.status === 'loading') return
    const target = prefs.readingLang
    const url = rep.url
    if (headline.status === 'done' && headline.url === url && headline.target === target) {
      showTranslated = !showTranslated
      return
    }
    headline = { status: 'loading' }
    try {
      const result = await translateHeadline(rep, target)
      if (rep.url !== url || prefs.readingLang !== target) {
        headline = { status: 'idle' }
        return
      }
      headline = { status: 'done', url, target, result }
      showTranslated = true
    } catch (err) {
      headline = { status: 'failed', reason: failureReason(err) }
    }
  }
</script>

<article
  data-signal-story
  data-story={cluster.id}
  class="signal-story relative h-full snap-start overflow-hidden"
  style="--wash: {wash}"
  data-photo={photo && !photoBroken ? '1' : undefined}
>
  {#if photo && !photoBroken}
    <img
      src={photo.url}
      alt=""
      class="absolute inset-0 h-full w-full object-cover"
      referrerpolicy="no-referrer"
      decoding="async"
      onerror={() => { photoBroken = true }}
    />
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/25"></div>
  {:else}
    <div class="signal-grain absolute inset-0"></div>
  {/if}
  <div class="relative flex h-full flex-col justify-end px-5 pb-8 pt-6">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <span class="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-400">{rep.source_region}</span>
      {#if repLang}
        <span class="text-[9px] font-mono uppercase tracking-wide text-gray-500 border border-gray-700/60 rounded px-1">{repLang}</span>
      {/if}
      <SignalBadges article={badgeSignals} />
      {#if shown}
        <span class="text-[10px] font-medium uppercase tracking-[0.12em] text-gray-500">Translated</span>
      {/if}
    </div>

    <a
      href={rep.url}
      target="_blank"
      rel="noopener noreferrer"
      dir={shown ? translatedDir : 'auto'}
      class="font-serif text-[2rem] leading-[1.12] font-medium tracking-tight text-white hover:text-blue-200"
      onclick={(e) => {
        if (onselect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
          e.preventDefault()
          onselect(rep)
        }
      }}
    >
      {headlineText(titleText)}
    </a>

    <p class="mt-3 text-sm text-gray-400 tabular-nums">
      {rep.source_name}
      · {cluster.sourceCount} {cluster.sourceCount === 1 ? 'source' : 'sources'}
      · {timeAgo(rep.published_at, clock.now)}
    </p>
    {#if photo && !photoBroken}
      <p class="mt-1 text-[11px] uppercase tracking-[0.14em] text-gray-500">Photo · {photo.sourceName}</p>
    {/if}

    {#if others.length > 0}
      <ul class="mt-4 space-y-1.5">
        {#each others as article (article.id)}
          <li class="flex items-center gap-2 text-sm text-gray-300 min-w-0">
            <span class="w-2 h-2 rounded-full shrink-0 {REGION_COLORS[article.source_region]?.split(' ')[0] ?? 'bg-gray-500'}"></span>
            <span class="truncate text-gray-400">
              {article.source_name} · {headlineText(article.title)}
            </span>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      {#if canTranslate}
        <button
          type="button"
          onclick={translate}
          aria-busy={headline.status === 'loading'}
          class="transition-colors {headline.status === 'failed' ? 'text-amber-400 hover:text-amber-300' : 'text-blue-400 hover:text-blue-300'}"
        >{translateLabel}</button>
      {/if}
      <ShareControls article={rep} {cluster} />
      <span class="text-[11px] uppercase tracking-[0.14em] text-gray-600">Tap the headline for every newsroom</span>
    </div>
  </div>
</article>
