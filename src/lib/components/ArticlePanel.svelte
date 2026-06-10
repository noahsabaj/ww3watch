<script lang="ts">
  import type { Article } from '$lib/types'
  import type { Cluster } from '$lib/cluster'
  import { timeAgo } from '$lib/utils'
  import { supabase } from '$lib/supabase'
  import { cleanHtml } from '$lib/sanitize-html'
  import { base } from '$app/paths'
  import RegionBadge from '$lib/components/RegionBadge.svelte'

  let { article, cluster = null, onclose, onselect }: {
    article: Article | null
    cluster?: Cluster | null
    onclose: () => void
    onselect?: (a: Article) => void
  } = $props()

  type ReaderState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'loaded'; title: string; byline: string | null; content: string }
    | { status: 'failed' }

  let reader = $state<ReaderState>({ status: 'idle' })

  type TranslateState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'done'; title: string; content: string }
    | { status: 'failed' }

  let translation = $state<TranslateState>({ status: 'idle' })
  let showTranslated = $state(false)

  // Junk extractions (bot-wall pages) come back with an empty title — fall back
  // to the RSS title for both the heading and the translate payload.
  const displayTitle = $derived(
    reader.status === 'loaded' && reader.title.trim() ? reader.title : article?.title ?? ''
  )

  const translateLabel = $derived(
    translation.status === 'loading' ? 'Translating…'
    : translation.status === 'failed' ? 'Translation failed — tap to retry'
    : showTranslated ? 'Show original'
    : 'Translate to English'
  )

  $effect(() => {
    const current = article
    if (!current) {
      reader = { status: 'idle' }
      return
    }
    translation = { status: 'idle' }
    showTranslated = false
    reader = { status: 'loading' }
    // Staleness guard instead of fetch-abort: ignore the response if the user
    // switched articles before it resolved.
    let cancelled = false
    supabase.functions
      .invoke('reader', { body: { url: current.url } })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data || data.error) {
          reader = { status: 'failed' }
        } else {
          // Bot-wall/redirect pages "extract" successfully as near-empty junk —
          // the failed state (RSS title + summary + original link) reads better.
          const text = new DOMParser().parseFromString(data.content ?? '', 'text/html')
            .body.textContent ?? ''
          reader = text.trim().length < 200
            ? { status: 'failed' }
            : { status: 'loaded', title: data.title, byline: data.byline, content: data.content }
        }
      })
      .catch(() => {
        if (!cancelled) reader = { status: 'failed' }
      })
    return () => {
      cancelled = true
    }
  })

  $effect(() => {
    document.body.style.overflow = article ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  })

  // ── Dialog focus management ────────────────────────────────────────────────
  let panelEl = $state<HTMLElement | null>(null)
  let closeBtn = $state<HTMLButtonElement | null>(null)
  let previouslyFocused: Element | null = null
  // Plain closure var (not $state): the in-panel source list swaps `article`
  // without closing, so focus logic must act only on open/close EDGES.
  let wasOpen = false

  $effect(() => {
    const open = !!article
    if (open && !wasOpen) {
      previouslyFocused = document.activeElement
      closeBtn?.focus()
    } else if (!open && wasOpen) {
      copied = false
      clearTimeout(copiedTimer)
      const el = previouslyFocused as HTMLElement | null
      // Realtime churn can unmount the originating button — only restore if alive.
      if (el?.isConnected && typeof el.focus === 'function') el.focus()
      previouslyFocused = null
    }
    wasOpen = open
  })

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !panelEl) return
    const focusables = panelEl.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !panelEl.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && article) onclose()
  }

  // Plain text for the translate payload — HTML-heavy input made the LLM emit
  // broken JSON (escaping every attribute quote) and 502 on real articles.
  function htmlToText(html: string): string {
    const body = new DOMParser().parseFromString(html, 'text/html').body
    const blocks = [...body.querySelectorAll('p, h1, h2, h3, li, blockquote')]
      // skip nested matches (blockquote > p would double-count its text)
      .filter(el => !el.parentElement?.closest('p, h1, h2, h3, li, blockquote'))
      .map(el => el.textContent?.trim() ?? '')
      .filter(Boolean)
    const joined = blocks.join('\n\n')
    const full = body.textContent?.trim() ?? ''
    // div-only article markup loses most text via the block query — fall back.
    return joined.length >= full.length * 0.6 ? joined : full
  }

  async function translate() {
    if (!article || translation.status === 'loading') return
    if (translation.status === 'done') { showTranslated = !showTranslated; return }
    translation = { status: 'loading' }
    const title = displayTitle
    // Slice matches the server's MAX_CONTENT_CHARS — no point shipping more.
    const content = reader.status === 'loaded'
      ? htmlToText(reader.content).slice(0, 8000)
      : (article.summary ?? '')
    try {
      const { data, error } = await supabase.functions.invoke('translate', {
        body: { title, content, lang: article.source_lang, url: article.url },
      })
      if (error || !data?.title || !data?.content) throw new Error('Translation failed')
      translation = { status: 'done', title: data.title, content: data.content }
      showTranslated = true
    } catch {
      translation = { status: 'failed' }
    }
  }

  let copied = $state(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  async function share() {
    if (!article) return
    const shareUrl = `${window.location.origin}${base}/?article=${article.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: article.title, url: shareUrl })
      } else {
        await navigator.clipboard.writeText(shareUrl)
        copied = true
        clearTimeout(copiedTimer)
        copiedTimer = setTimeout(() => (copied = false), 2000)
      }
    } catch (err) {
      // Cancelling the share sheet rejects with AbortError — that's normal.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('[share] failed:', err)
      }
    }
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

  <!-- Panel (div, not aside: a modal dialog isn't complementary content) -->
  <div
    bind:this={panelEl}
    role="dialog"
    aria-modal="true"
    aria-label="Article reader"
    tabindex="-1"
    onkeydown={trapFocus}
    class="panel-slide fixed top-0 right-0 h-full w-full md:w-[45%] lg:w-[38%] bg-[#0a0a0b] border-l border-gray-800 z-50 flex flex-col"
    style="padding-top: env(safe-area-inset-top, 0px);"
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
        onclick={share}
        aria-label={copied ? 'Link copied' : 'Share article'}
        class="md:hidden shrink-0 ml-1 transition-colors {copied ? 'text-green-400' : 'text-gray-500 hover:text-gray-200'}"
      >
        {#if copied}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
        {/if}
      </button>
      <button
        bind:this={closeBtn}
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
        <h1 dir="auto" class="text-xl font-bold text-white leading-snug mb-2">
          {showTranslated && translation.status === 'done' ? translation.title : displayTitle}
        </h1>
        {#if reader.byline}
          <p class="text-xs text-gray-500 mb-3">{reader.byline}</p>
        {/if}
        {#if article.source_lang !== 'en'}
          <button
            onclick={translate}
            class="text-xs transition-colors mb-4 block {translation.status === 'failed' ? 'text-amber-400 hover:text-amber-300' : 'text-blue-400 hover:text-blue-300'}"
          >
            {translateLabel}
          </button>
        {/if}
        <div class="prose-reader" dir="auto">
          {#if showTranslated && translation.status === 'done'}
            <!-- Translations are plain-text paragraphs — text interpolation, no sanitize needed -->
            {#each translation.content.split(/\n{2,}/) as para}
              <p>{para}</p>
            {/each}
          {:else}
            <!-- cleanHtml = DOMPurify; also absolutizes relative URLs against the article's origin -->
            {@html cleanHtml(reader.content, article.url)}
          {/if}
        </div>

      {:else if reader.status === 'failed'}
        <h1 dir="auto" class="text-xl font-bold text-white leading-snug mb-3">
          {showTranslated && translation.status === 'done' ? translation.title : article.title}
        </h1>
        {#if article.source_lang !== 'en'}
          <button
            onclick={translate}
            class="text-xs transition-colors mb-3 block {translation.status === 'failed' ? 'text-amber-400 hover:text-amber-300' : 'text-blue-400 hover:text-blue-300'}"
          >
            {translateLabel}
          </button>
        {/if}
        {#if article.summary}
          <p dir="auto" class="text-gray-300 leading-relaxed mb-6">
            {showTranslated && translation.status === 'done' ? translation.content : article.summary}
          </p>
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

      {#if cluster && cluster.sourceCount > 1 && reader.status !== 'loading'}
        <div class="mt-8 pt-5 border-t border-gray-800">
          <p class="text-[10px] uppercase tracking-widest text-gray-600 mb-3">{cluster.sourceCount} sources covered this</p>
          <div class="space-y-2">
            {#each cluster.articles as other (other.id)}
              <div class="flex items-center gap-2 py-0.5">
                <RegionBadge region={other.source_region} size="sm" />
                <span class="text-xs text-gray-500 shrink-0">{other.source_name}</span>
                {#if other.id === article.id}
                  <span class="text-xs text-blue-400 line-clamp-1 flex-1 min-w-0">← reading now</span>
                {:else}
                  <button
                    onclick={() => onselect?.(other)}
                    dir="auto"
                    class="text-xs text-gray-300 hover:text-blue-400 transition-colors line-clamp-1 flex-1 min-w-0 text-start"
                  >
                    {other.title}
                  </button>
                {/if}
                <span class="text-xs text-gray-600 shrink-0">{timeAgo(other.published_at)}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

    </div>
  </div>
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
  }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Animations only for users who haven't asked for reduced motion. The slide
     lives in a class (not an inline style) so this media block can gate it. */
  @media (prefers-reduced-motion: no-preference) {
    .panel-slide { animation: slideIn 200ms ease-out; }
    .shimmer { animation: shimmer 1.4s infinite; }
  }

  /* unicode-bidi: plaintext = per-paragraph first-strong direction, so mixed
     Persian/English article bodies (injected via {@html}) each align correctly. */
  :global(.prose-reader p)      { color: #d1d5db; line-height: 1.75; margin-bottom: 1rem; font-size: 0.9375rem; unicode-bidi: plaintext; }
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
