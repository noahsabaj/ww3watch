// Supabase Edge Function: article reader/extractor (Deno).
// Fetches a known article's URL, extracts the readable article with Mozilla
// Readability, and returns it. Guarded against SSRF (initial host AND every
// redirect hop); results are cached in public.article_content (instant repeat
// opens + survives source takedowns). The returned HTML is sanitized on the
// CLIENT with DOMPurify before {@html}.
//
// verify_jwt is off (the publishable key is not a JWT), so the abuse control is
// the articles.url gate + per-IP rate limiting (see _shared/ratelimit.ts).

import { Readability } from 'npm:@mozilla/readability@0.6.0'
import { parseHTML } from 'npm:linkedom@0.18.12'
import { corsHeaders, json } from '../_shared/http.ts'
import { serviceClient } from '../_shared/client.ts'
import { rateLimited, tooLarge } from '../_shared/ratelimit.ts'
import { fetchGuarded } from '../_shared/net.ts'

const supabase = serviceClient()

const MAX_CACHE_CONTENT_CHARS = 400_000
// Generous human-proof ceiling; cache hits count too (they're still requests).
const RATE_LIMIT_PER_HOUR = 120
// Conflict reporting has the highest correction/retraction rate of any genre —
// re-extract a cached copy older than this so corrections propagate (falling
// back to the stale copy if the re-fetch fails, preserving the link-rot archive).
const CACHE_FRESH_MS = 24 * 3600_000

type CacheRow = {
  title: string
  byline: string | null
  content: string
  site_name: string | null
  fetched_at: string
}
const staleHit = (c: CacheRow) =>
  json({ title: c.title, byline: c.byline, content: c.content, siteName: c.site_name, fetchedAt: c.fetched_at, cached: true, stale: true })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Bound the request body before reading/parsing it.
  const big = tooLarge(req)
  if (big) return big

  let articleUrl: string | null = new URL(req.url).searchParams.get('url')
  if (!articleUrl && req.method === 'POST') {
    try {
      const body = await req.json()
      if (typeof body?.url === 'string') articleUrl = body.url
    } catch {
      // fall through
    }
  }
  if (!articleUrl) return json({ error: 'missing_url' }, 400)

  const limited = await rateLimited(supabase, req, 'reader', RATE_LIMIT_PER_HOUR)
  if (limited) return limited

  // Gate: only URLs the pipeline ingested. Blocks cache-stuffing and limits the
  // SSRF/proxy surface to our own article set.
  const { data: known, error: gateError } = await supabase
    .from('articles')
    .select('url')
    .eq('url', articleUrl)
    .limit(1)
  if (gateError) console.error('[reader] gate lookup failed:', gateError)
  if (!known?.length) return json({ error: 'unknown_article' }, 404)

  // Cache: a FRESH copy serves directly; a STALE copy gets a re-extraction attempt
  // (corrections propagate) and is the fallback if the re-fetch/extract fails.
  const { data: cached } = await supabase
    .from('article_content')
    .select('title, byline, content, site_name, fetched_at')
    .eq('url', articleUrl)
    .maybeSingle()
  const cacheAgeMs = cached?.fetched_at ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity
  if (cached && cacheAgeMs < CACHE_FRESH_MS) {
    return json({
      title: cached.title,
      byline: cached.byline,
      content: cached.content,
      siteName: cached.site_name,
      fetchedAt: cached.fetched_at,
      cached: true,
    })
  }

  // (Re-)extract.
  let html: string
  try {
    const res = await fetchGuarded(articleUrl, 8000)
    if (!res.ok) throw new Error(`status ${res.status}`)
    html = await res.text()
  } catch (err) {
    if (cached) return staleHit(cached as CacheRow) // serve the prior good copy
    const msg = err instanceof Error ? err.message : String(err)
    const blocked = msg === 'invalid_url' || msg === 'blocked_host'
    return json({ error: blocked ? 'invalid_url' : 'extraction_failed' }, blocked ? 400 : 422)
  }

  try {
    // linkedom returns a DOM-like document; cast through unknown so we don't need
    // the browser `Document` lib type (absent in Deno) — Readability reads it fine.
    const { document } = parseHTML(html) as unknown as { document: unknown }
    const article = new Readability(document as never).parse()
    if (!article) {
      if (cached) return staleHit(cached as CacheRow)
      return json({ error: 'extraction_failed' }, 422)
    }

    const result = {
      title: article.title ?? '',
      byline: article.byline ?? null,
      content: article.content ?? '',
      siteName: article.siteName ?? null,
    }

    const now = new Date().toISOString()
    const textLen = (article.textContent ?? '').trim().length
    if (result.content && result.content.length <= MAX_CACHE_CONTENT_CHARS && textLen >= 200) {
      // Overwrite on refresh (ignoreDuplicates:false) and ALWAYS set fetched_at —
      // PostgREST only updates payload columns, so omitting it would freeze the
      // timestamp and turn the cache into a permanent origin-hammering pass-through.
      const { error: cacheError } = await supabase.from('article_content').upsert(
        {
          url: articleUrl,
          title: result.title,
          byline: result.byline,
          content: result.content,
          site_name: result.siteName,
          fetched_at: now,
        },
        { onConflict: 'url', ignoreDuplicates: false },
      )
      if (cacheError) console.error('[reader] cache write failed:', cacheError)
      return json({ ...result, fetchedAt: now })
    }

    // Near-empty extraction (bot-wall/redirect page): never persist junk. If we
    // have a prior good copy, keep serving it; else return the uncached result.
    if (cached) return staleHit(cached as CacheRow)
    return json({ ...result, fetchedAt: now })
  } catch {
    if (cached) return staleHit(cached as CacheRow)
    return json({ error: 'extraction_failed' }, 422)
  }
})
