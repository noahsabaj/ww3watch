<script lang="ts">
  import { headlineText } from '$lib/utils'
  import type { Article } from '$lib/types'
  import type { Cluster } from '$lib/cluster'
  import { storyTimeline } from '$lib/cluster'
  import { timeAgo, langTag, offsetLabel, LANG_NAMES, TARGET_LANGS, isRtlLang } from '$lib/utils'
  import { prefs, setReadingLang } from '$lib/prefs.svelte'
  import { clock } from '$lib/now.svelte'
  import { supabase } from '$lib/supabase'
  import { failureLabel, failureReason, type TranslateFailure } from '$lib/translate'
  import { cleanHtml } from '$lib/sanitize-html'
  import { base } from '$app/paths'
  import ShareControls from '$lib/components/ShareControls.svelte'
  import RegionBadge from '$lib/components/RegionBadge.svelte'
  import AffiliationBadge from '$lib/components/AffiliationBadge.svelte'
  import SignalBadges from '$lib/components/SignalBadges.svelte'

  // inline: the desk's story pane hosts the reader in place (no backdrop, no
  // focus trap, the page keeps scrolling). Otherwise it is a modal dialog over
  // Signal on a phone.
  let { article, cluster = null, onclose, onselect, inline = false }: {
    article: Article | null
    cluster?: Cluster | null
    onclose: () => void
    onselect?: (a: Article) => void
    inline?: boolean
  } = $props()

  type ReaderState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'loaded'; title: string; byline: string | null; content: string; fetchedAt?: string | null; contentVersion?: string }
    | { status: 'failed' }

  let reader = $state<ReaderState>({ status: 'idle' })

  type TranslateState =
    | { status: 'idle' }
    | { status: 'loading' }
    // isHtml: content is reassembled article HTML (images/structure preserved,
    // rendered via cleanHtml); otherwise plain-text paragraphs.
    | { status: 'done'; title: string; content: string; isHtml: boolean; untranslated: number }
    | { status: 'failed'; reason: TranslateFailure }

  // Upper bound on what we'll ship in one request — a guard on body size
  // (the function rejects >200KB), NOT a translation cap. How much actually
  // gets translated is one decision, made server-side by a token budget, and
  // whatever it echoes back untranslated is reported to the reader below.
  const MAX_REQUEST_CHARS = 150_000

  let translation = $state<TranslateState>({ status: 'idle' })
  let showTranslated = $state(false)

  // Junk extractions (bot-wall pages) come back with an empty title — fall back
  // to the RSS title for both the heading and the translate payload.
  const displayTitle = $derived(
    reader.status === 'loaded' && reader.title.trim() ? reader.title : article?.title ?? ''
  )

  const translateLabel = $derived(
    translation.status === 'loading' ? 'Translating…'
    : translation.status === 'failed' ? failureLabel(translation.reason)
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

  // Keyed on the URL, not the article object: the feed replaces a row's object
  // on a realtime cluster-assignment patch, and re-reading the same article
  // would refetch the extraction and silently discard an open translation.
  // The URL is what the reader actually loads.
  $effect(() => {
    const url = article?.url
    if (!url) {
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
      .invoke('reader', { body: { url } })
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
            : { status: 'loaded', title: data.title, byline: data.byline, content: data.content, fetchedAt: data.fetchedAt, contentVersion: data.contentVersion }
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
    if (inline) return
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
      const el = previouslyFocused as HTMLElement | null
      // Realtime churn can unmount the originating button — only restore if alive.
      if (el?.isConnected && typeof el.focus === 'function') el.focus()
      previouslyFocused = null
    }
    wasOpen = open
  })

  function trapFocus(e: KeyboardEvent) {
    if (inline || e.key !== 'Tab' || !panelEl) return
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
    const target = prefs.readingLang
    try {
      const { data, error } = await supabase.functions.invoke('translate', { body: {
        version: 2, url: article.url, target,
        mode: reader.status === 'loaded' && reader.contentVersion ? 'reader' : 'summary',
        contentVersion: reader.status === 'loaded' ? reader.contentVersion : undefined,
      } })
      if (error) throw error
      if (!data || typeof data.title !== 'string' || typeof data.content !== 'string') throw new Error('Translation failed')
      translation = { status:'done',title:data.title,content:data.content,isHtml:data.format==='html',untranslated:data.untranslated ?? 0 }
      showTranslated = true
    } catch (err) {
      translation = { status: 'failed', reason: failureReason(err) }
    }
  }

</script>

<svelte:window onkeydown={handleKeydown} />

{#if article}
  <!-- Reading-language picker (set once, remembered) + a Translate action. The
       picker is ALWAYS shown so the reader can switch languages even when the
       article is already in their reading language — gating both on
       source_lang !== readingLang stranded same-language readers (a Russian
       reader on a Russian article had no button AND no way to switch). The
       Translate button only appears when there's a different language to
       translate into. Rendered in both the loaded and failed reader states. -->
  {#snippet translateControls()}
    {#if article}
      <div class="flex items-center gap-2">
        {#if article.source_lang !== prefs.readingLang}
          <button
            onclick={translate}
            class="action {translation.status === 'failed' ? '!text-amber-400' : '!text-accent'}"
          >{translateLabel}</button>
          <span class="text-fg-3" aria-hidden="true">→</span>
        {:else}
          <span class="text-fg-3">Original ({LANG_NAMES[article.source_lang] ?? article.source_lang.toUpperCase()}) · read in</span>
        {/if}
        <select
          value={prefs.readingLang}
          onchange={(e) => changeReadingLang(e.currentTarget.value)}
          aria-label="Reading language"
          class="field min-h-9 w-auto py-1 pl-3 pr-8 text-[13px]"
        >
          {#each TARGET_LANGS as code}
            <option value={code}>{LANG_NAMES[code]}</option>
          {/each}
        </select>
      </div>
    {/if}
  {/snippet}

  {#if !inline}
    <!-- Backdrop -->
    <div
      class="fixed inset-0 bg-black/50 z-40"
      onclick={onclose}
      role="presentation"
    ></div>
  {/if}

  <!-- Modal: a dialog (div, not aside — a modal isn't complementary content).
       Inline: a labelled region of the story pane. -->
  <div
    bind:this={panelEl}
    role={inline ? 'region' : 'dialog'}
    aria-modal={inline ? undefined : 'true'}
    aria-label="Article reader"
    tabindex="-1"
    onkeydown={trapFocus}
    class={inline
      ? 'h-full bg-ink flex flex-col'
      : 'panel-slide fixed top-0 right-0 h-full w-full md:w-[45%] lg:w-[38%] bg-ink border-l border-line z-50 flex flex-col'}
    style={inline ? undefined : 'padding-top: env(safe-area-inset-top, 0px);'}
  >
    <!-- Top bar: the way back, and the way out to the publisher. -->
    <div class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-2">
      <button
        bind:this={closeBtn}
        onclick={onclose}
        class={inline ? 'action px-3 text-sm' : 'icon-btn'}
        aria-label="Close reader"
      >
        {#if inline}← Story{:else}<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>{/if}
      </button>
      <a href={article.url} target="_blank" rel="noopener noreferrer" class="action px-3 text-sm">Read original ↗</a>
    </div>

    <!-- Content area -->
    <div class="flex-1 overflow-y-auto px-5 pt-6 pb-10 {inline ? 'lg:px-10' : ''}">
      <div class="mx-auto {inline ? 'max-w-3xl' : 'max-w-2xl'}">

      <!-- Who published it. -->
      <div class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-fg-3">
        <RegionBadge region={article.source_region} />
        <span aria-hidden="true">·</span>
        <span class="text-[13px] font-medium text-fg">{article.source_name}</span>
        {#if langTag(article.source_lang)}<span class="tag font-mono">{langTag(article.source_lang)}</span>{/if}
        <AffiliationBadge affiliation={article.source_affiliation} />
        <SignalBadges {article} />
        <span class="whitespace-nowrap">· {timeAgo(article.published_at, clock.now)}</span>
      </div>

      {#if reader.status === 'loading'}
        <div class="space-y-3" aria-hidden="true">
          <div class="h-8 w-11/12 rounded-lg bg-raised shimmer"></div>
          <div class="h-8 w-2/3 rounded-lg bg-raised shimmer"></div>
        </div>
      {:else}
        <h1 dir="auto" class="font-serif text-[1.9rem] font-medium leading-[1.15] tracking-tight text-fg">
          {showTranslated && translation.status === 'done' ? translation.title : reader.status === 'loaded' ? displayTitle : article.title}
        </h1>
        {#if reader.status === 'loaded' && (reader.byline || snapshotAgeLabel)}
          <p class="mt-3 text-xs text-fg-3">
            {#if reader.byline}{reader.byline}{/if}
            {#if snapshotAgeLabel}<span title="Articles are often corrected or updated after first publication; this is when the reader cached this copy.">{reader.byline ? ' · ' : ''}{snapshotAgeLabel}</span>{/if}
          </p>
        {/if}
      {/if}

      <!-- Tools: translation, sharing, and the two ways to question a source. -->
      <div class="mt-4 mb-7 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line pb-3 text-[13px]">
        {#if reader.status !== 'loading'}{@render translateControls()}{/if}
        <ShareControls {article} {cluster} />
        <a href="{base}/feedback?article={article.id}" class="action">Report</a>
        <a href="{base}/about{article.source_id ? `#source-${encodeURIComponent(article.source_id)}` : '#sources'}" class="action">Source profile</a>
      </div>

      {#if reader.status === 'loading'}
        <div class="space-y-2.5" aria-hidden="true">
          {#each [12, 11, 12, 10, 12, 9, 11] as w, i (i)}
            <div class="h-4 rounded bg-raised shimmer" style="width: {(w / 12) * 100}%"></div>
          {/each}
        </div>

      {:else if reader.status === 'loaded'}
        <!-- A long article can exceed the translator's output budget; the tail
             comes back in its original language. Say so rather than serving a
             silently half-translated page. -->
        {#if showTranslated && translation.status === 'done' && translation.untranslated > 0}
          <p class="mb-4 text-xs text-amber-400/90">
            {translation.untranslated}
            {translation.untranslated === 1 ? 'text segment remains' : 'text segments remain'} in the original language. Names and short labels may stay unchanged; long articles may exceed the translation limit.
          </p>
        {/if}
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
        {#if article.summary}
          <p dir={showTranslated && translation.status === 'done' ? translatedDir : 'auto'} class="mb-6 text-[17px] leading-relaxed text-fg-2">
            {showTranslated && translation.status === 'done' ? translation.content : article.summary}
          </p>
        {/if}
        <a href={article.url} target="_blank" rel="noopener noreferrer" class="btn-ghost text-sm">
          Full article unavailable — read original ↗
        </a>
      {/if}

      {#if clusterTimeline && reader.status !== 'loading'}
        <section class="mt-10 border-t border-line pt-6">
          <h2 class="label mb-3">
            {clusterTimeline.sourceCount} sources{#if clusterTimeline.firstAt} · first reported {timeAgo(new Date(clusterTimeline.firstAt).toISOString(), clock.now)}{/if}
          </h2>
          <!-- Chronological: oldest first, the original report tagged. -->
          <ol class="space-y-1">
            {#each clusterTimeline.ordered as entry (entry.article.id)}
              <li class="flex items-start gap-3 rounded-lg px-2 py-2 {entry.article.id === article.id ? 'bg-white/[0.04]' : ''}">
                <span class="w-11 shrink-0 pt-0.5 text-right font-mono text-[10px] {entry.isFirst ? 'text-amber-300' : 'text-fg-3'}">
                  {entry.isFirst ? 'FIRST' : entry.offsetMs !== null ? offsetLabel(entry.offsetMs) : ''}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-3">
                    <RegionBadge region={entry.article.source_region} size="sm" />
                    <span class="text-fg-2">{entry.article.source_name}</span>
                    {#if langTag(entry.article.source_lang)}<span class="font-mono uppercase">{langTag(entry.article.source_lang)}</span>{/if}
                    <AffiliationBadge affiliation={entry.article.source_affiliation} />
                    {#if entry.isWire}
                      <span class="tag" title="Near-identical to an earlier article in this story — likely syndicated wire copy">wire</span>
                    {/if}
                  </div>
                  {#if entry.article.id === article.id}
                    <p dir="auto" class="mt-1 text-[14px] leading-snug text-fg">{entry.article.title} <span class="text-accent">· reading</span></p>
                  {:else}
                    <button
                      onclick={() => onselect?.(entry.article)}
                      dir="auto"
                      class="mt-1 block text-start text-[14px] leading-snug text-fg-2 transition-colors hover:text-fg"
                    >
                      {entry.article.title}
                    </button>
                  {/if}
                </div>
              </li>
            {/each}
          </ol>
        </section>
      {/if}

      </div>
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
      #15181c 25%,
      #1f2328 50%,
      #15181c 75%
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
  :global(.prose-reader p)      { color: #c9ccd2; line-height: 1.75; margin-bottom: 1.1rem; font-size: 1.0625rem; unicode-bidi: plaintext; }
  :global(.prose-reader h1),
  :global(.prose-reader h2),
  :global(.prose-reader h3)     { color: var(--color-fg); font-family: var(--font-serif); font-weight: 500; font-size: 1.25rem; margin: 1.75rem 0 0.5rem; }
  :global(.prose-reader a)      { color: var(--color-accent); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgb(143 180 245 / 0.35); }
  :global(.prose-reader img)    { max-width: 100%; border-radius: 0.75rem; margin: 1.25rem 0; }
  :global(.prose-reader ul),
  :global(.prose-reader ol)     { color: #c9ccd2; padding-left: 1.5rem; margin-bottom: 1rem; line-height: 1.75; }
  :global(.prose-reader blockquote) { border-inline-start: 2px solid var(--color-line-strong); padding-inline-start: 1rem; color: var(--color-fg-2); margin: 1.25rem 0; }
  :global(.prose-reader figure) { margin: 1rem 0; }
  :global(.prose-reader figcaption) { color: var(--color-fg-3); font-size: 0.8125rem; margin-top: 0.25rem; }
</style>
