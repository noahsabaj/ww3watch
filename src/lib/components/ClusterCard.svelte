<script lang="ts">
  import type { Cluster } from '$lib/cluster'
  import { REGION_COLORS, REGION_BORDER } from '$lib/types'

  let { cluster }: { cluster: Cluster } = $props()
  let expanded = $state(false)

  function timeAgo(dateStr: string | null): string {
    if (!dateStr) return 'unknown time'
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  function langFlag(lang: string): string {
    const flags: Record<string, string> = {
      fa: '🇮🇷', ar: '🇸🇦', he: '🇮🇱', ru: '🇷🇺',
      zh: '🇨🇳', tr: '🇹🇷', fr: '🇫🇷', de: '🇩🇪', ur: '🇵🇰',
    }
    return flags[lang] ?? ''
  }

  const rep = $derived(cluster.representative)
  const others = $derived(cluster.articles.slice(1))
  const isSingle = $derived(cluster.sourceCount === 1)
  const regionDots = $derived(
    [...new Set(cluster.articles.map(a => a.source_region))].slice(0, 5)
  )
  const repFlag = $derived(langFlag(rep.source_lang))
</script>

<article class="border-l-4 {REGION_BORDER[rep.source_region]} bg-[#111113] hover:bg-[#18181b] transition-colors px-4 py-3">
  <!-- Header row -->
  <div class="flex items-center gap-2 mb-1.5 flex-wrap">
    <span class="text-xs font-semibold px-2 py-0.5 rounded {REGION_COLORS[rep.source_region]}">
      {rep.source_region}
    </span>
    <span class="text-sm font-medium text-gray-300">
      {repFlag}{repFlag ? ' ' : ''}{rep.source_name}
    </span>
    {#if !isSingle}
      <div class="flex items-center gap-1 ml-1">
        {#each regionDots as region}
          <span class="w-2 h-2 rounded-full {REGION_COLORS[region]?.split(' ')[0] ?? 'bg-gray-500'}"></span>
        {/each}
        <span class="text-xs text-gray-400 font-medium ml-0.5">+{cluster.sourceCount - 1} more</span>
      </div>
    {/if}
    <span class="text-xs text-gray-500 ml-auto" title={rep.published_at ?? ''}>{timeAgo(rep.published_at)}</span>
  </div>

  <!-- Headline -->
  <a
    href={rep.url}
    target="_blank"
    rel="noopener noreferrer"
    class="block text-white font-semibold leading-snug hover:text-blue-400 transition-colors mb-1"
  >
    {rep.title}
  </a>

  <!-- Summary -->
  {#if rep.summary}
    <p class="text-sm text-gray-400 line-clamp-2 mb-2">{rep.summary}</p>
  {/if}

  <!-- Expand toggle -->
  {#if !isSingle}
    <button
      onclick={() => expanded = !expanded}
      class="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors mt-1"
    >
      <span class="inline-block transition-transform {expanded ? 'rotate-180' : ''}">▾</span>
      {expanded ? 'Hide sources' : `${cluster.sourceCount} sources covered this`}
    </button>

    {#if expanded}
      <div class="mt-2 space-y-1 border-t border-gray-800 pt-2">
        {#each others as article (article.id)}
          <div class="flex items-center gap-2 py-0.5">
            <span class="text-xs font-semibold px-1.5 py-0.5 rounded shrink-0 {REGION_COLORS[article.source_region]}">
              {article.source_region}
            </span>
            <span class="text-xs text-gray-400 shrink-0">
              {langFlag(article.source_lang)}{article.source_name}
            </span>
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-gray-300 hover:text-blue-400 transition-colors line-clamp-1 flex-1 min-w-0"
            >
              {article.title}
            </a>
            <span class="text-xs text-gray-600 shrink-0">{timeAgo(article.published_at)}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</article>
