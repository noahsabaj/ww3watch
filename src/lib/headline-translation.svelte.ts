// Opt-in headline translation for one story's lead. Translation is the one
// place model prose reaches the feed, so it is a tap away, labeled, and one more
// tap from the original (docs/CONVENTIONS.md). Offered only when the headline
// isn't already in the reading language.
//
// Must be created during component init: it registers an $effect.
import { untrack } from 'svelte'
import type { Article } from './types'
import { prefs } from './prefs.svelte'
import { isRtlLang } from './utils'
import {
  cachedHeadline, failureLabel, failureReason, translateHeadline,
  type HeadlineTranslation, type TranslateFailure,
} from './translate'

type HeadlineState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; url: string; target: string; result: HeadlineTranslation }
  | { status: 'failed'; reason: TranslateFailure }

export function createHeadlineTranslation(getArticle: () => Article) {
  let headline = $state<HeadlineState>({ status: 'idle' })
  let showTranslated = $state(false)

  // What's on screen: the translation, only while it is for THIS headline (the
  // representative can change under a realtime regroup) in the CURRENT reading
  // language, and the reader hasn't flipped back to the original.
  const shown = $derived.by(() => {
    const a = getArticle()
    return showTranslated && headline.status === 'done' && headline.url === a.url && headline.target === prefs.readingLang
      ? headline.result
      : null
  })

  // A headline already translated this session comes back translated when its
  // story remounts or the reading language returns to one it was translated
  // into — the opt-in was given; asking again is friction.
  $effect(() => {
    const target = prefs.readingLang
    const a = getArticle()
    const hit = cachedHeadline(a, target)
    if (!hit) return
    const current = untrack(() => headline)
    if (current.status === 'done' && current.url === a.url && current.target === target) return
    headline = { status: 'done', url: a.url, target, result: hit }
    showTranslated = true
  })

  async function toggle() {
    if (headline.status === 'loading') return
    const a = getArticle()
    const target = prefs.readingLang
    if (headline.status === 'done' && headline.url === a.url && headline.target === target) {
      showTranslated = !showTranslated
      return
    }
    headline = { status: 'loading' }
    try {
      const result = await translateHeadline(a, target)
      // Staleness guard: the lead or the reading language moved on mid-request.
      if (getArticle().url !== a.url || prefs.readingLang !== target) {
        headline = { status: 'idle' }
        return
      }
      headline = { status: 'done', url: a.url, target, result }
      showTranslated = true
    } catch (err) {
      headline = { status: 'failed', reason: failureReason(err) }
    }
  }

  return {
    /** The translation on screen, or null for the original. */
    get shown() { return shown },
    get available() { return getArticle().source_lang !== prefs.readingLang },
    get busy() { return headline.status === 'loading' },
    get failed() { return headline.status === 'failed' },
    get label() {
      return headline.status === 'loading' ? 'Translating…'
        : headline.status === 'failed' ? failureLabel(headline.reason)
        : shown ? 'Translated · show original'
        : 'Translate'
    },
    /** dir for translated text; the original keeps dir="auto". */
    get dir() { return shown ? (isRtlLang(prefs.readingLang) ? 'rtl' : 'ltr') : 'auto' },
    toggle,
  }
}
