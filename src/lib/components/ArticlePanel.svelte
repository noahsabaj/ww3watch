<script lang="ts">
  import type { Article } from '$lib/types'
  import { timeAgo } from '$lib/utils'
  import RegionBadge from '$lib/components/RegionBadge.svelte'

  let { article, onclose }: {
    article: Article | null
    onclose: () => void
  } = $props()

  type ReaderState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'loaded'; title: string; byline: string | null; content: string }
    | { status: 'failed' }

  let reader = $state<ReaderState>({ status: 'idle' })

  $effect(() => {
    if (!article) {
      reader = { status: 'idle' }
      return
    }
    const controller = new AbortController()
    reader = { status: 'loading' }
    fetch(`/api/reader?url=${encodeURIComponent(article.url)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          reader = { status: 'failed' }
        } else {
          reader = { status: 'loaded', title: data.title, byline: data.byline, content: data.content }
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') reader = { status: 'failed' }
      })
    return () => controller.abort()
  })

  $effect(() => {
    document.body.style.overflow = article ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  })

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if article}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/50 z-40"
    onclick={onclose}
    role="presentation"
  ></div>

  <!-- Panel -->
  <aside
    class="fixed top-0 right-0 h-full w-full md:w-[45%] lg:w-[38%] bg-[#0a0a0b] border-l border-gray-800 z-50 flex flex-col"
    style="animation: slideIn 200ms ease-out; padding-top: env(safe-area-inset-top, 0px);"
  >
    <!-- Top bar -->
    <div class="flex items-center gap-2 px-4 py-3 border-b border-gray-800 shrink-0 min-w-0">
      <RegionBadge region={article.source_region} />
      <span class="text-sm font-medium text-gray-300 truncate min-w-0">{article.source_name}</span>
      <span class="text-xs text-gray-500 shrink-0 whitespace-nowrap">{timeAgo(article.published_at)}</span>
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        class="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors shrink-0 whitespace-nowrap"
      >
        Read original ↗
      </a>
      <button
        onclick={onclose}
        class="text-gray-500 hover:text-gray-200 transition-colors text-lg leading-none shrink-0 ml-1"
        aria-label="Close reader"
      >
        ✕
      </button>
    </div>

    <!-- Content area -->
    <div class="flex-1 overflow-y-auto px-6 py-5">

      {#if reader.status === 'loading'}
        <div class="space-y-3">
          <div class="h-7 bg-gray-800 rounded w-3/4 shimmer"></div>
          <div class="h-7 bg-gray-800 rounded w-1/2 shimmer"></div>
          <div class="h-4 bg-gray-800/60 rounded w-1/3 mt-4 shimmer"></div>
          <div class="space-y-2 mt-6">
            <div class="h-4 bg-gray-800 rounded shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-11/12 shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-full shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-10/12 shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-full shimmer"></div>
          </div>
          <div class="space-y-2 mt-4">
            <div class="h-4 bg-gray-800 rounded w-full shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-9/12 shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-full shimmer"></div>
            <div class="h-4 bg-gray-800 rounded w-11/12 shimmer"></div>
          </div>
        </div>

      {:else if reader.status === 'loaded'}
        <h1 class="text-xl font-bold text-white leading-snug mb-2">{reader.title}</h1>
        {#if reader.byline}
          <p class="text-xs text-gray-500 mb-5">{reader.byline}</p>
        {/if}
        <div class="prose-reader">
          {@html reader.content}
        </div>

      {:else if reader.status === 'failed'}
        <h1 class="text-xl font-bold text-white leading-snug mb-3">{article.title}</h1>
        {#if article.summary}
          <p class="text-gray-300 leading-relaxed mb-6">{article.summary}</p>
        {/if}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-block text-sm border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors px-3 py-1.5 rounded"
        >
          Full article unavailable — read original ↗
        </a>
      {/if}

    </div>
  </aside>
{/if}

<style>
  @keyframes slideIn {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }

  .shimmer {
    background: linear-gradient(
      90deg,
      #1f2937 25%,
      #374151 50%,
      #1f2937 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite;
  }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  :global(.prose-reader p)      { color: #d1d5db; line-height: 1.75; margin-bottom: 1rem; font-size: 0.9375rem; }
  :global(.prose-reader h1),
  :global(.prose-reader h2),
  :global(.prose-reader h3)     { color: white; font-weight: 600; margin: 1.5rem 0 0.5rem; }
  :global(.prose-reader a)      { color: #60a5fa; text-decoration: underline; }
  :global(.prose-reader img)    { max-width: 100%; border-radius: 4px; margin: 1rem 0; }
  :global(.prose-reader ul),
  :global(.prose-reader ol)     { color: #d1d5db; padding-left: 1.5rem; margin-bottom: 1rem; line-height: 1.75; }
  :global(.prose-reader blockquote) { border-left: 3px solid #4b5563; padding-left: 1rem; color: #9ca3af; margin: 1rem 0; }
  :global(.prose-reader figure) { margin: 1rem 0; }
  :global(.prose-reader figcaption) { color: #6b7280; font-size: 0.8125rem; margin-top: 0.25rem; }
</style>
