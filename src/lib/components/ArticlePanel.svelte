<script lang="ts">
  import type { Article } from '$lib/types'
  import type { Cluster } from '$lib/cluster'
  import { storyTimeline } from '$lib/cluster'
  import { timeAgo, langTag, offsetLabel, LANG_NAMES, TARGET_LANGS, isRtlLang } from '$lib/utils'
  import { prefs, setReadingLang } from '$lib/prefs.svelte'
  import { clock } from '$lib/now.svelte'
  import { supabase } from '$lib/supabase'
  import { cleanHtml } from '$lib/sanitize-html'
  import { base } from '$app/paths'
  import RegionBadge from '$lib/components/RegionBadge.svelte'
  import AffiliationBadge from '$lib/components/AffiliationBadge.svelte'

  let { article, cluster = null, onclose, onselect }: {
    article: Article | null
    cluster?: Cluster | null
    onclose: () => void
    onselect?: (a: Article) => void
  } = $props()

  type ReaderState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'loaded'; title: string; byline: string | null; content: string; fetchedAt?: string | null }
    | { status: 'failed' }

  let reader = $state<ReaderState>({ status: 'idle' })

  type TranslateState =
    | { status: 'idle' }
    | { status: 'loading' }
    // isHtml: content is reassembled article HTML (images/structure preserved,
    // rendered via cleanHtml); otherwise plain-text paragraphs.
    | { status: 'done'; title: string; content: string; isHtml: boolean }
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
    : 'Translate'
  )
  // Translated output renders RTL when the reading language is RTL (the source
  // body keeps dir="auto").
  const translatedDir = $derived(isRtlLang(prefs.readingLang) ? 'rtl' : 'ltr')

  function changeReadingLang(code: string) {
    if (code === prefs.readingLang) return
    const wasShowing = showTranslated && translation.status === 'done'
    setReadingLang(code)
    translation = { status: 'idle' }
    showTranslated = false
    // Re-translate to the newly chosen language if one was already on screen.
    if (wasShowing && article && article.source_lang !== code) translate()
  }

  // When the cached extraction is more than a few hours old, label its vintage —
  // conflict reporting is corrected/retracted often, so a silent old snapshot is
  // a duty-of-care gap. Guarded: N-1 reader responses omit fetchedAt → no line.
  const snapshotAgeLabel = $derived.by(() => {
    if (reader.status !== 'loaded' || !reader.fetchedAt) return null
    if (clock.now - new Date(reader.fetchedAt).getTime() < 3 * 3600_000) return null
    return `Snapshot from ${timeAgo(reader.fetchedAt, clock.now)}`
  })

  // Chronological "who reported first" timeline for the in-panel source list.
  const clusterTimeline = $derived(cluster && cluster.sourceCount > 1 ? storyTimeline(cluster.articles) : null)

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
            : { status: 'loaded', title: data.title, byline: data.byline, content: data.content, fetchedAt: data.fetchedAt }
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
    const target = prefs.readingLang
    try {
      // Preferred path: translate the article's text blocks and re-insert the
      // translations into the ORIGINAL DOM, so images/figures/layout survive
      // (the LLM only sees plain text). Falls back to flattened plain text when
      // there are no clean text blocks (div-only markup) or the reader failed.
      if (reader.status === 'loaded') {
        const doc = new DOMParser().parseFromString(reader.content, 'text/html')
        // Translate at the TEXT-NODE level, not whole blocks: a pure paragraph is
        // a single text node (translated whole, no fragmentation), while a
        // paragraph with an inline <a>/<strong>/<img> yields several text nodes —
        // so we only ever swap text and never destroy inline elements, images, or
        // structure. We capture each node's surrounding whitespace and re-wrap so
        // words don't glue to adjacent inline elements.
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
        const nodes: Text[] = []
        const segments: string[] = []
        const wraps: Array<[string, string]> = []
        for (let node = walker.nextNode(); node && segments.length < 100; node = walker.nextNode()) {
          const raw = node.nodeValue ?? ''
          const trimmed = raw.trim()
          if (!trimmed) continue
          const tag = node.parentElement?.tagName
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE') continue
          nodes.push(node as Text)
          segments.push(trimmed)
          wraps.push([raw.slice(0, raw.length - raw.trimStart().length), raw.slice(raw.trimEnd().length)])
        }
        if (segments.length > 0) {
          const { data, error } = await supabase.functions.invoke('translate', {
            body: { title, segments, lang: article.source_lang, url: article.url, target },
          })
          if (error || !data?.title || !Array.isArray(data?.segments)) throw new Error('Translation failed')
          // 1:1 by index; a missing translation leaves the original text in place.
          nodes.forEach((node, i) => {
            const t = data.segments[i]
            if (typeof t === 'string' && t.trim()) node.nodeValue = wraps[i][0] + t + wraps[i][1]
          })
          translation = { status: 'done', title: data.title, content: doc.body.innerHTML, isHtml: true }
          showTranslated = true
          return
        }
      }
      // Plain-text fallback (failed reader or div-only markup).
      const plain = reader.status === 'loaded'
        ? htmlToText(reader.content).slice(0, 8000)
        : (article.summary ?? '')
      const { data, error } = await supabase.functions.invoke('translate', {
        body: { title, content: plain, lang: article.source_lang, url: article.url, target },
      })
      if (error || !data?.title || typeof data?.content !== 'string') throw new Error('Translation failed')
      translation = { status: 'done', title: data.title, content: data.content, isHtml: false }
      showTranslated = true
    } catch {
      translation = { status: 'failed' }
    }
  }

  let copied = $state(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  async function share() {
    if (!article) return
    // Story-first: a multi-source story gets a durable ?story= link (the recipient
    // lands on the full cluster, and a story_id outlives any single pruned member).
    // Singletons share the article directly.
    const shareUrl =
      cluster?.storyId && cluster.sourceCount > 1
        ? `${window.location.origin}${base}/?story=${cluster.storyId}`
        : `${window.location.origin}${base}/?article=${article.id}`
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
  <!-- Translate action + reading-language picker (set once, remembered). Hidden
       when the article is already in the reading language. Rendered in both the
       loaded and failed reader states. -->
  {#snippet translateControls()}
    {#if article && article.source_lang !== prefs.readingLang}
      <div class="flex items-center gap-2 mb-4 flex-wrap text-xs">
        <button
          onclick={translate}
          class="transition-colors {translation.status === 'failed' ? 'text-amber-400 hover:text-amber-300' : 'text-blue-400 hover:text-blue-300'}"
        >{translateLabel}</button>
        <span class="text-gray-600" aria-hidden="true">→</span>
        <select
          value={prefs.readingLang}
          onchange={(e) => changeReadingLang(e.currentTarget.value)}
          aria-label="Reading language"
          class="bg-[#1a1a1d] border border-gray-700 rounded text-gray-300 py-0.5 px-1.5 focus:outline-none focus:border-blue-500"
        >
          {#each TARGET_LANGS as code}
            <option value={code}>{LANG_NAMES[code]}</option>
          {/each}
        </select>
      </div>
    {/if}
  {/snippet}

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
      <span class="flex items-center gap-1.5 text-sm font-medium text-gray-300 min-w-0">
        {#if langTag(article.source_lang)}<span class="text-[9px] font-mono uppercase tracking-wide text-gray-500 border border-gray-700/60 rounded px-1 shrink-0">{langTag(article.source_lang)}</span>{/if}
        <span class="truncate">{article.source_name}</span>
        <AffiliationBadge affiliation={article.source_affiliation} />
      </span>
      <span class="text-xs text-gray-500 shrink-0 whitespace-nowrap">{timeAgo(article.published_at, clock.now)}</span>
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
        {#if snapshotAgeLabel}
          <p class="text-xs text-gray-600 mb-3" title="Articles are often corrected or updated after first publication; this is when the reader cached this copy.">{snapshotAgeLabel}</p>
        {/if}
        {@render translateControls()}
        <div class="prose-reader" dir={showTranslated && translation.status === 'done' ? translatedDir : 'auto'}>
          {#if showTranslated && translation.status === 'done'}
            {#if translation.isHtml}
              <!-- Reassembled article HTML: original images/figures/layout, translated text.
                   cleanHtml = DOMPurify + URL absolutization, same as the original render. -->
              {@html cleanHtml(translation.content, article.url)}
            {:else}
              <!-- Plain-text fallback (div-only markup / failed reader) -->
              {#each translation.content.split(/\n{2,}/) as para}
                <p>{para}</p>
              {/each}
            {/if}
          {:else}
            <!-- cleanHtml = DOMPurify; also absolutizes relative URLs against the article's origin -->
            {@html cleanHtml(reader.content, article.url)}
          {/if}
        </div>

      {:else if reader.status === 'failed'}
        <h1 dir="auto" class="text-xl font-bold text-white leading-snug mb-3">
          {showTranslated && translation.status === 'done' ? translation.title : article.title}
        </h1>
        {@render translateControls()}
        {#if article.summary}
          <p dir={showTranslated && translation.status === 'done' ? translatedDir : 'auto'} class="text-gray-300 leading-relaxed mb-6">
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

      {#if clusterTimeline && reader.status !== 'loading'}
        <div class="mt-8 pt-5 border-t border-gray-800">
          <p class="text-[10px] uppercase tracking-widest text-gray-600 mb-3">
            {clusterTimeline.sourceCount} sources{#if clusterTimeline.firstAt} · first reported {timeAgo(new Date(clusterTimeline.firstAt).toISOString(), clock.now)}{/if}
          </p>
          <!-- Chronological: oldest first, the original report tagged. -->
          <div class="space-y-2">
            {#each clusterTimeline.ordered as entry (entry.article.id)}
              <div class="flex items-center gap-2 py-0.5">
                <span class="text-[9px] font-mono shrink-0 w-12 text-right {entry.isFirst ? 'text-amber-400 font-bold' : 'text-gray-600'}">
                  {entry.isFirst ? 'FIRST' : entry.offsetMs !== null ? offsetLabel(entry.offsetMs) : ''}
                </span>
                <RegionBadge region={entry.article.source_region} size="sm" />
                <span class="flex items-center gap-1 text-xs text-gray-500 shrink-0">
                  {#if langTag(entry.article.source_lang)}<span class="text-[9px] font-mono uppercase tracking-wide text-gray-500 border border-gray-700/60 rounded px-1">{langTag(entry.article.source_lang)}</span>{/if}
                  {entry.article.source_name}
                </span>
                <AffiliationBadge affiliation={entry.article.source_affiliation} />
                {#if entry.isWire}
                  <span class="text-[9px] uppercase tracking-wider text-gray-600 border border-gray-700/60 rounded px-1 shrink-0" title="Near-identical to an earlier article in this story — likely syndicated wire copy">wire</span>
                {/if}
                {#if entry.article.id === article.id}
                  <span class="text-xs text-blue-400 line-clamp-1 flex-1 min-w-0">← reading now</span>
                {:else}
                  <button
                    onclick={() => onselect?.(entry.article)}
                    dir="auto"
                    class="text-xs text-gray-300 hover:text-blue-400 transition-colors line-clamp-1 flex-1 min-w-0 text-start"
                  >
                    {entry.article.title}
                  </button>
                {/if}
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
