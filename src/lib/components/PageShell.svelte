<script lang="ts">
  import Icon from '$lib/components/Icon.svelte'
  import type { Snippet } from 'svelte'
  import { base } from '$app/paths'
  import { afterNavigate } from '$app/navigation'
  import { page } from '$app/state'
  import { browser } from '$app/environment'
  import SiteMenu from '$lib/components/SiteMenu.svelte'

  // Every page that isn't the feed: the feed's header (wordmark home, the same
  // menu), a serif title, and one footer. `wide` is for data pages (Trends).
  let {
    title,
    lede,
    wide = false,
    children,
  }: {
    title: string
    lede?: string
    wide?: boolean
    children: Snippet
  } = $props()

  // Reached from an open article (the reader's Report and Source profile links
  // carry ?article=): the way back is that article, not the top of the feed.
  // Coming straight from the feed, history.back() returns to the reader's own
  // entry; otherwise the link deep-links the article.
  // Browser only: /about and /feedback are prerendered, and prerendering has no query string.
  const articleId = $derived(browser ? page.url.searchParams.get('article') : null)
  let fromFeed = false
  afterNavigate(({ from }) => {
    fromFeed = !!from && from.url.pathname.replace(/\/$/, '') === base
  })
</script>

<div class="flex min-h-dvh flex-col bg-ink">
  <header class="sticky top-0 z-30 border-b border-line bg-ink px-4" style="padding-top: env(safe-area-inset-top, 0px)">
    <div class="mx-auto flex h-16 items-center gap-4 px-1 {wide ? 'max-w-6xl' : 'max-w-3xl'}">
      <a href="{base}/" class="text-lg font-bold tracking-tight text-fg">WW3Watch</a>
      {#if articleId}
        <a
          href="{base}/?article={encodeURIComponent(articleId)}"
          onclick={(e) => { if (fromFeed) { e.preventDefault(); history.back() } }}
          class="action ml-auto gap-1.5 text-sm"
        ><Icon name="arrow-left" size={15} />Back to article</a>
      {:else}
        <a href="{base}/" class="action ml-auto gap-1.5 text-sm"><Icon name="arrow-left" size={15} />Latest reporting</a>
      {/if}
      <SiteMenu />
    </div>
  </header>

  <main class="mx-auto w-full flex-1 px-5 pt-10 pb-20 {wide ? 'max-w-6xl' : 'max-w-3xl'}">
    <h1 class="font-serif text-[2.4rem] font-medium leading-[1.1] tracking-tight text-fg sm:text-5xl">{title}</h1>
    {#if lede}<p class="mt-4 max-w-2xl text-lg leading-relaxed text-fg-2">{lede}</p>{/if}
    <div class="mt-10">
      {@render children()}
    </div>
  </main>

  <footer class="border-t border-line px-5 py-8" style="padding-bottom: calc(2rem + env(safe-area-inset-bottom, 0px))">
    <div class="mx-auto flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-fg-3 {wide ? 'max-w-6xl' : 'max-w-3xl'}">
      <a class="action" href="{base}/about">About & methodology</a>
      <a class="action" href="{base}/trends">Trends</a>
      <a class="action" href="{base}/privacy">Privacy</a>
      <a class="action" href="{base}/feedback">Feedback & corrections</a>
      <span class="sm:ml-auto">Open source · AGPL-3.0</span>
    </div>
  </footer>
</div>
