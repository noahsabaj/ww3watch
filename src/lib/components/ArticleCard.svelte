<script lang="ts">
  import type { Article } from '$lib/types'
  import { REGION_COLORS, REGION_BORDER } from '$lib/types'

  let { article }: { article: Article } = $props()

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
      zh: '🇨🇳', tr: '🇹🇷', fr: '🇫🇷', de: '🇩🇪', ur: '🇵🇰'
    }
    return flags[lang] ?? ''
  }
</script>

<article
  class="border-l-4 {REGION_BORDER[article.source_region]} bg-[#111113] hover:bg-[#18181b] transition-colors px-4 py-3"
>
  <div class="flex items-center gap-2 mb-1.5 flex-wrap">
    <span class="text-xs font-semibold px-2 py-0.5 rounded {REGION_COLORS[article.source_region]}">
      {article.source_region}
    </span>
    <span class="text-sm font-medium text-gray-300">
      {langFlag(article.source_lang)}{langFlag(article.source_lang) ? ' ' : ''}{article.source_name}
    </span>
    <span class="text-xs text-gray-500 ml-auto" title={article.published_at ?? ''}>
      {timeAgo(article.published_at)}
    </span>
  </div>

  <a
    href={article.url}
    target="_blank"
    rel="noopener noreferrer"
    class="block text-white font-semibold leading-snug hover:text-blue-400 transition-colors mb-1"
  >
    {article.title}
  </a>

  {#if article.summary}
    <p class="text-sm text-gray-400 line-clamp-2">{article.summary}</p>
  {/if}
</article>
