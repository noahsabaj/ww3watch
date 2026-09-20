// Client side of the translate edge function for the feed's cards: a
// headline + summary in, the same in the reading language out.
//
// One module-level cache for the whole session so a card that is filtered out
// and back in (remounted) shows its translation again without a round-trip, and
// two cards for the same article (feed + trending) never translate it twice.
// Keyed on url + target: the server caches by content hash, this only saves
// the network hop.
import { supabase } from './supabase'
import type { Article } from './types'

export interface HeadlineTranslation {
  title: string
  summary: string | null
}

// Why a translation failed, as far as the reader is concerned. The server's
// 429 (per-IP hourly bucket) is the one case where "try again later" is the
// truth and "tap to retry" is a lie.
export type TranslateFailure = 'rate_limited' | 'failed' | 'refresh_required' | 'upgrade_required'

export class TranslateError extends Error {
  constructor(public readonly reason: TranslateFailure) {
    super(reason)
    this.name = 'TranslateError'
  }
}

export function failureLabel(reason: TranslateFailure): string {
  if (reason === 'refresh_required') return 'Article changed — close and reopen to translate'
  if (reason === 'upgrade_required') return 'Reload WW3Watch to update translation'
  return reason === 'rate_limited'
    ? 'Translation limit reached — try again later'
    : 'Translation failed — tap to retry'
}

// supabase-js wraps a non-2xx as FunctionsHttpError with the Response on
// `.context`; anything else (network, relay) is a plain failure.
export function failureReason(error: unknown): TranslateFailure {
  if (error instanceof TranslateError) return error.reason
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status
  if (status === 409) return 'refresh_required'
  if (status === 426) return 'upgrade_required'
  return status === 429 ? 'rate_limited' : 'failed'
}

const SEP = ''
const cache = new Map<string, HeadlineTranslation>()
const inflight = new Map<string, Promise<HeadlineTranslation>>()

function key(article: Pick<Article, 'url'>, target: string): string {
  return article.url + SEP + target
}

export function cachedHeadline(article: Pick<Article, 'url'>, target: string): HeadlineTranslation | undefined {
  return cache.get(key(article, target))
}

export function translateHeadline(
  article: Pick<Article, 'url' | 'title' | 'summary' | 'source_lang'>,
  target: string,
): Promise<HeadlineTranslation> {
  // Already in the reading language: nothing to translate, no request.
  if (article.source_lang === target) {
    return Promise.resolve({ title: article.title, summary: article.summary })
  }
  const k = key(article, target)
  const hit = cache.get(k)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(k)
  if (pending) return pending

  const run = (async (): Promise<HeadlineTranslation> => {
    const { data, error } = await supabase.functions.invoke('translate', {
      body: { version: 2, url: article.url, mode: 'summary', target },
    })
    if (error) throw new TranslateError(failureReason(error))
    if (!data || typeof data.title !== 'string' || typeof data.content !== 'string') {
      throw new TranslateError('failed')
    }
    const result: HeadlineTranslation = {
      title: data.title,
      // An article without a summary sends '' and gets '' back — keep it null so
      // the card doesn't render an empty paragraph.
      summary: article.summary ? data.content : null,
    }
    cache.set(k, result)
    return result
  })()
  inflight.set(k, run)
  return run.finally(() => inflight.delete(k))
}

// Test seam: the cache is module-global by design, so tests reset it explicitly.
export function _resetHeadlineCache(): void {
  cache.clear()
  inflight.clear()
}
