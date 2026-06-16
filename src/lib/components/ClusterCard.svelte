<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import { wireDuplicateIds, storyTimeline } from '$lib/cluster'
  import type { Article } from '$lib/types'
  import { REGION_COLORS, REGION_BORDER } from '$lib/types'
  import { timeAgo, langTag, isBreaking, offsetLabel } from '$lib/utils'
  import { clock } from '$lib/now.svelte'
  import RegionBadge from '$lib/components/RegionBadge.svelte'
  import AffiliationBadge from '$lib/components/AffiliationBadge.svelte'

  let { cluster, onselect }: { cluster: Cluster; onselect?: (a: Article) => void } = $props()
  let expanded = $state(false)

  const rep = $derived(cluster.representative)
  const isSingle = $derived(cluster.sourceCount === 1)
  const regionDots = $derived(
    [...new Set(cluster.articles.map(a => a.source_region))].slice(0, 5)
  )
  const repLang = $derived(langTag(rep.source_lang))

  // Wire-syndication marks: members sharing a body_hash are reprints of the same
  // agency copy. Badge every copy EXCEPT the earliest-published origin (shared
  // with trending's independent-source count so the two never drift).
  const wireIds = $derived(wireDuplicateIds(cluster.articles))

  // Chronological "who reported first" view for the expanded section.
  const timeline = $derived(storyTimeline(cluster.articles))

  // BREAKING is reserved for genuinely corroborated breakers, not "a feed emitted
  // XML < 30 min ago" (which on ~900 articles/day would paint the whole feed red).
  // Require a recent representative AND ≥3 distinct non-wire sources whose
  // earliest report is < 90 min old; everything else recent gets a neutral NEW.
  const breaking = $derived.by(() => {
    if (!isBreaking(rep.published_at, clock.now)) return false
    const independent = new Set(
      cluster.articles.filter(a => !wireIds.has(a.id)).map(a => a.source_name)
    )
    if (independent.size < 3) return false
    const times = cluster.articles
      .map(a => (a.published_at ? new Date(a.published_at).getTime() : null))
      .filter((t): t is number => t !== null)
    const earliest = times.length ? Math.min(...times) : clock.now
    return clock.now - earliest < 90 * 60 * 1000
  })
  const isNew = $derived(!breaking && isBreaking(rep.published_at, clock.now))
</script>

<!-- content-visibility:auto lets the browser skip rendering/layout for cards
     scrolled off-screen (a 200+ card feed otherwise lays out every card on each
     reactive update). contain-intrinsic-size:auto remembers each card's real
     height after first paint, falling back to ~180px, so the scrollbar stays
     stable. Native virtualization — no JS, no interaction with the divider/
     pagination/filter logic, and off-screen cards remain in the a11y tree. -->
<article class="[content-visibility:auto] [contain-intrinsic-size:auto_180px] border-l-4 {REGION_BORDER[rep.source_region] ?? 'border-gray-600'} bg-[#111113] hover:bg-[#18181b] transition-colors px-4 py-3">
  <!-- Header row -->
  <div class="flex items-center gap-2 mb-1.5 min-w-0">
    <RegionBadge region={rep.source_region} />
    {#if breaking}
      <span class="bg-red-950/60 border border-red-800/60 text-red-400 text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded shrink-0">BREAKING</span>
    {:else if isNew}
      <span class="bg-gray-800/70 border border-gray-700 text-gray-400 text-[10px] font-semibold tracking-widest px-1.5 py-0.5 rounded shrink-0">NEW</span>
    {/if}
    <span class="flex items-center gap-1.5 text-sm font-medium text-gray-300 min-w-0">
      {#if repLang}<span class="text-[9px] font-mono uppercase tracking-wide text-gray-500 border border-gray-700/60 rounded px-1 shrink-0">{repLang}</span>{/if}
      <span class="truncate">{rep.source_name}</span>
      <AffiliationBadge affiliation={rep.source_affiliation} />
    </span>
    {#if !isSingle}
      <div class="flex items-center gap-1 shrink-0">
        {#each regionDots as region}
          <span class="w-2 h-2 rounded-full {REGION_COLORS[region]?.split(' ')[0] ?? 'bg-gray-500'}"></span>
        {/each}
        <span class="text-xs text-gray-400 font-medium ml-0.5">+{cluster.sourceCount - 1} more</span>
      </div>
    {/if}
    <span class="text-xs text-gray-500 ml-auto shrink-0 whitespace-nowrap" title={rep.published_at ?? ''}>{timeAgo(rep.published_at, clock.now)}</span>
  </div>

  <!-- Headline -->
  <a
    href={rep.url}
    target="_blank"
    rel="noopener noreferrer"
    dir="auto"
    class="block text-white font-semibold leading-snug hover:text-blue-400 transition-colors mb-1 cursor-pointer"
    onclick={(e) => {
      // Plain left-click opens the reader; modified clicks (ctrl/cmd/shift/alt)
      // fall through to the href so open-in-new-tab keeps working.
      if (onselect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        onselect(rep)
      }
    }}
  >
    {rep.title}
  </a>

  <!-- Summary -->
  {#if rep.summary}
    <p dir="auto" class="text-sm text-gray-400 line-clamp-2 {isSingle ? '' : 'mb-2'}">{rep.summary}</p>
  {/if}

  <!-- Expand toggle -->
  {#if !isSingle}
    <button
      onclick={() => expanded = !expanded}
      aria-expanded={expanded}
      aria-controls="cluster-sources-{cluster.id}"
      class="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors mt-1"
    >
      <span class="inline-block transition-transform {expanded ? 'rotate-180' : ''}">▾</span>
      {expanded ? 'Hide sources' : `${cluster.sourceCount} sources covered this`}
    </button>

    {#if expanded}
      <div id="cluster-sources-{cluster.id}" class="mt-2 border-t border-gray-800 pt-2">
        {#if timeline.firstAt}
          <p class="text-[10px] text-gray-600 mb-2">
            First reported {timeAgo(new Date(timeline.firstAt).toISOString(), clock.now)} · {cluster.sourceCount} sources across {timeline.regionCount}
            {timeline.regionCount === 1 ? 'region' : 'regions'}
          </p>
        {/if}
        <!-- Chronological timeline: oldest first, the original report tagged. -->
        <div class="space-y-1">
          {#each timeline.ordered as entry (entry.article.id)}
            <div class="flex items-center gap-2 py-0.5">
              <span class="text-[9px] font-mono shrink-0 w-12 text-right {entry.isFirst ? 'text-amber-400 font-bold' : 'text-gray-600'}">
                {entry.isFirst ? 'FIRST' : entry.offsetMs !== null ? offsetLabel(entry.offsetMs) : ''}
              </span>
              <RegionBadge region={entry.article.source_region} size="sm" />
              <span class="flex items-center gap-1 text-xs text-gray-400 shrink-0">
                {#if langTag(entry.article.source_lang)}<span class="text-[9px] font-mono uppercase tracking-wide text-gray-500 border border-gray-700/60 rounded px-1">{langTag(entry.article.source_lang)}</span>{/if}
                {entry.article.source_name}
              </span>
              <AffiliationBadge affiliation={entry.article.source_affiliation} />
              {#if entry.isWire}
                <span class="text-[9px] uppercase tracking-wider text-gray-600 border border-gray-700/60 rounded px-1 shrink-0" title="Near-identical to an earlier article in this story — likely syndicated wire copy">wire</span>
              {/if}
              <a
                href={entry.article.url}
                target="_blank"
                rel="noopener noreferrer"
                dir="auto"
                class="text-xs text-gray-300 hover:text-blue-400 transition-colors line-clamp-1 flex-1 min-w-0"
                onclick={(e) => {
                  // Plain left-click opens the reader; modified clicks fall through.
                  if (onselect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                    e.preventDefault()
                    onselect(entry.article)
                  }
                }}
              >
                {entry.article.title}
              </a>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</article>
