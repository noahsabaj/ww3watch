<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import { REGION_BORDER } from '$lib/types'
  import { dayKey, dayLabel, headlineText, langTag, timeAgo } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import type { ReaderRouting } from '$lib/deeplink.svelte'
  import type { SortMode } from '$lib/filters.svelte'
  import { base } from '$app/paths'
  import DeskStory from '$lib/components/DeskStory.svelte'
  import ArticlePanel from '$lib/components/ArticlePanel.svelte'

  // The desktop home: every story in a scannable column on the left, the
  // selected one on the right in Signal's treatment, and reading happens in
  // that pane instead of over it.
  let {
    clusters,
    trending,
    reader,
    sortMode,
    onSortMode,
    hasMore,
    loadingMore,
    onLoadOlder,
    lastVisitAt,
    newCount,
    onFlush,
    paused = $bindable(false),
  }: {
    clusters: Cluster[]
    trending: Cluster[]
    reader: ReaderRouting
    sortMode: SortMode
    onSortMode: (mode: SortMode) => void
    hasMore: boolean
    loadingMore: boolean
    onLoadOlder: () => Promise<void>
    lastVisitAt: number | null
    newCount: number
    onFlush: () => void
    paused?: boolean
  } = $props()

  let rail = $state<HTMLElement | null>(null)
  let pane = $state<HTMLElement | null>(null)
  let pickedId = $state<string | null>(null)

  // What the pane shows: the story being read (a deep link can open one that
  // isn't in the filtered list), else the one picked in the rail, else the top.
  const selected = $derived.by(() => {
    const reading = reader.selectedCluster
    if (reading) return clusters.find((c) => c.id === reading.id) ?? reading
    const picked = pickedId && (clusters.find((c) => c.id === pickedId) ?? trending.find((c) => c.id === pickedId))
    return picked || clusters[0] || null
  })

  // "New since your last visit": the first story older than the last visit, in
  // Latest only (Top isn't in time order).
  const lastVisitIndex = $derived.by(() => {
    if (lastVisitAt === null || sortMode === 'top') return -1
    const t = (c: Cluster) => (c.representative.published_at ? Date.parse(c.representative.published_at) : 0)
    for (let i = 1; i < clusters.length; i++) {
      if (t(clusters[i - 1]) > lastVisitAt && t(clusters[i]) <= lastVisitAt) return i
    }
    return -1
  })

  function select(c: Cluster) {
    pickedId = c.id
    if (reader.selectedArticle) reader.closeArticle()
  }

  function move(step: number) {
    if (clusters.length === 0) return
    const i = selected ? clusters.findIndex((c) => c.id === selected.id) : -1
    const next = clusters[Math.min(clusters.length - 1, Math.max(0, i + step))]
    select(next)
    // Focus follows the selection, so the ring and the highlighted row never
    // disagree and a screen reader announces the story it moved to.
    requestAnimationFrame(() => {
      const row = rail?.querySelector<HTMLElement>(`[data-desk-story="${CSS.escape(next.id)}"]`)
      row?.focus({ preventScroll: true })
      row?.scrollIntoView({ block: 'nearest' })
    })
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
    const target = e.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"], details[open]')) return
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'o' && selected && !reader.selectedArticle) { e.preventDefault(); reader.openArticle(selected.representative) }
  }

  function flush() {
    onFlush()
    rail?.scrollTo({ top: 0 })
  }

  // A different story (or opening/closing the reader) starts the pane at the top.
  $effect(() => {
    void selected?.id
    void reader.selectedArticle?.id
    pane?.scrollTo({ top: 0 })
  })

  const tab = 'text-[11px] px-2.5 py-1 rounded-full border transition-colors'
</script>

<svelte:window onkeydown={onKeydown} />

<div class="grid min-h-0 flex-1 grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
  <!-- Rail -->
  <nav
    bind:this={rail}
    data-desk-rail
    aria-label="Stories"
    class="relative min-h-0 overflow-y-auto border-r border-gray-800/80"
    onscroll={() => (paused = (rail?.scrollTop ?? 0) > 300)}
  >
    <div class="sticky top-0 z-10 flex items-center gap-1 border-b border-gray-800/80 bg-[#0a0a0b]/95 px-4 py-2 backdrop-blur">
      <div class="flex items-center gap-1" role="group" aria-label="Feed order">
        {#each [['latest', 'Latest'], ['top', 'Top · 24h']] as [mode, label] (mode)}
          <button
            type="button"
            onclick={() => onSortMode(mode as SortMode)}
            aria-pressed={sortMode === mode}
            title={mode === 'top' ? 'The last 24 hours, ranked by severity, independent corroboration and recency' : 'Newest first'}
            class="{tab} {sortMode === mode ? 'border-blue-500/50 bg-blue-600/15 text-blue-300' : 'border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600'}"
          >{label}</button>
        {/each}
      </div>
      {#if newCount > 0 && paused}
        <button type="button" onclick={flush} class="ml-auto rounded-full bg-blue-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-500">
          ↑ {newCount} new
        </button>
      {/if}
    </div>

    {#if lastVisitAt === null}
      <section class="border-b border-gray-800/60 px-4 py-3 text-xs leading-relaxed text-gray-400" aria-label="About this feed">
        Global conflict reporting from every side, grouped into stories. Automated labels and grouping do not verify a claim.
        <a class="text-blue-400 underline" href="{base}/about">How WW3Watch works</a>
      </section>
    {/if}

    {#if trending.length > 0}
      <section class="border-b border-gray-800/60 px-4 pt-3 pb-2" aria-labelledby="trending-heading">
        <h2 id="trending-heading" class="mb-1 text-[10px] uppercase tracking-[0.18em] text-gray-500">Trending now</h2>
        <ol>
          {#each trending as c, i (c.id)}
            <li>
              <button
                type="button"
                data-trending-story={c.id}
                onclick={() => select(c)}
                aria-current={selected?.id === c.id ? 'true' : undefined}
                class="flex w-full items-baseline gap-2 rounded py-1.5 text-start text-[13px] leading-snug transition-colors {selected?.id === c.id ? 'text-white' : 'text-gray-300 hover:text-white'}"
              >
                <span class="w-3 shrink-0 font-mono text-[11px] text-gray-600">{i + 1}</span>
                <span dir="auto" class="line-clamp-2">{headlineText(c.representative.title)}</span>
              </button>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    <ol class="pb-10">
      {#each clusters as c, i (c.id)}
        {@const rep = c.representative}
        {@const active = selected?.id === c.id}
        {#if sortMode === 'latest' && (i === 0 || dayKey(rep.published_at, clock.now) !== dayKey(clusters[i - 1].representative.published_at, clock.now))}
          <li aria-hidden="true" class="px-4 pt-4 pb-1 text-[10px] uppercase tracking-[0.18em] text-gray-600" data-day>{dayLabel(rep.published_at, clock.now)}</li>
        {/if}
        {#if i === lastVisitIndex}
          <li role="separator" class="px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-blue-400/70">New since your last visit <span aria-hidden="true">↑</span></li>
        {/if}
        <li>
          <button
            type="button"
            data-desk-story={c.id}
            onclick={() => select(c)}
            aria-current={active ? 'true' : undefined}
            class="block w-full border-l-[3px] rounded-none px-4 py-3 text-start transition-colors {REGION_BORDER[rep.source_region] ?? 'border-gray-600'} {active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'}"
          >
            <span class="flex items-center gap-1.5 text-[11px] text-gray-500 tabular-nums">
              <span>{rep.source_region}</span>
              {#if langTag(rep.source_lang)}<span class="font-mono">{langTag(rep.source_lang)}</span>{/if}
              <span aria-hidden="true">·</span>
              <span>{c.sourceCount} {c.sourceCount === 1 ? 'outlet' : 'outlets'}</span>
              <span class="ml-auto">{timeAgo(rep.published_at, clock.now)}</span>
            </span>
            <span dir="auto" class="mt-1 block text-[15px] leading-snug line-clamp-3 {active ? 'text-white font-medium' : 'text-gray-200'}">
              {headlineText(rep.title)}
            </span>
          </button>
        </li>
      {/each}
      <li class="px-4 pt-6 text-center">
        {#if hasMore && sortMode === 'latest'}
          <button
            id="feed-load-older"
            type="button"
            onclick={onLoadOlder}
            aria-disabled={loadingMore}
            class="rounded-full border border-gray-800 px-5 py-2 text-sm text-gray-400 hover:border-gray-600 hover:text-gray-200 aria-disabled:opacity-50"
          >{loadingMore ? 'Loading…' : 'Load older stories'}</button>
        {:else}
          <p id="feed-end" tabindex="-1" class="text-xs text-gray-600 outline-none">
            {sortMode === 'top' ? 'That’s every ranked story from the last 24 hours.' : 'You’ve reached the oldest stories.'}
          </p>
        {/if}
        <p class="mt-4 text-[11px] text-gray-700">j / k to move · o to read</p>
      </li>
    </ol>
  </nav>

  <!-- Pane -->
  <div bind:this={pane} data-desk-pane class="min-h-0 overflow-y-auto bg-[#070809]">
    {#if reader.selectedArticle}
      <ArticlePanel inline article={reader.selectedArticle} cluster={reader.selectedCluster} onclose={reader.closeArticle} onselect={reader.openArticle} />
    {:else if selected}
      {#key selected.id}
        <DeskStory cluster={selected} onread={reader.openArticle} />
      {/key}
    {/if}
  </div>
</div>
