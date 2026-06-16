import Parser from 'rss-parser'
import { XMLParser } from 'fast-xml-parser'
import { bodyHash } from './wire'
import type { Feed, SourceRegion } from '../types'

type ArticleInsert = {
  guid: string
  title: string
  url: string
  summary: string | null
  published_at: string | null
  source_name: string
  source_region: SourceRegion
  source_lang: string
  source_affiliation: string | null
  feed_url: string
  source_id: string | null
  body_hash: string | null
}

// 'blocked' = the origin served a non-feed (WAF "Just a moment…" challenge,
// login wall, soft-404) — distinct from 'parse' (a real but malformed feed) so
// curation can tell "needs a UA/unblock" from "needs a feed fix". Exported as a
// const array so the pipeline's per-kind tally can't drift from this list.
export const FEED_ERROR_KINDS = ['http', 'timeout', 'parse', 'network', 'blocked'] as const
export type FeedErrorKind = (typeof FEED_ERROR_KINDS)[number]

export interface FeedFetchResult {
  feed: Feed
  articles: ArticleInsert[]
  /** which path produced the result (or was attempted last on failure) */
  via: 'direct' | 'proxy'
  /** count of items whose pubDate parsed but was clamped out of range (telemetry) */
  clamped?: number
  error?: { kind: FeedErrorKind; detail: string }
}

const FEED_TIMEOUT_MS = 8000
const PROXY_TIMEOUT_MS = FEED_TIMEOUT_MS + 4000 // proxy adds a hop; give it headroom
// A real browser User-Agent + Accept-Language. Many news WAFs 403 (or serve a
// challenge page to) a bot UA but pass a browser one — verified 2026-06 across
// Novaya, iStories, Morocco World News, etc. The Worker sends the SAME pair to
// the origin (cloudflare/feed-proxy.js); the app's direct path uses it too.
const FEED_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
}

const parser = new Parser()
// Tolerant second-pass parser for feeds that are XML-ish but trip rss-parser's
// strict sax (unescaped &, stray tags). Lenient by default: no validation throw.
const lenientParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', htmlEntities: true })

class FeedError extends Error {
  constructor(
    public kind: FeedErrorKind,
    public detail: string,
  ) {
    super(detail)
  }
}

export function buildGuid(item: { guid?: unknown; link?: string }): string {
  const g = item.guid
  if (typeof g === 'string' && g.trim() !== '') return g
  // rss-parser returns guid as an object { _: 'text', $: {...} } when the <guid>
  // element carries XML attributes (e.g. isPermaLink). Pull out the text — passing
  // the object downstream blows up PostgREST's .in('guid', ...) serialization.
  if (g && typeof g === 'object') {
    const text = (g as { _?: unknown })._
    if (typeof text === 'string' && text.trim() !== '') return text
  }
  return item.link ?? ''
}

const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000 // tolerate minor publisher clock skew
const MAX_PAST_AGE_MS = 365 * 24 * 60 * 60 * 1000 // 1 year

// Some feeds (notably locale-formatted Persian/Arabic ones) emit pubDate strings
// that `new Date()` can't parse. `new Date('garbage').toISOString()` throws a
// RangeError — and because the throw happens inside the items .map() below, it
// used to drop the ENTIRE feed. Return null on any unparseable date instead.
//
// ALSO clamp out-of-range dates to null: a feed with a broken timezone/year emits
// future- or ancient-dated items that otherwise poison every recency calc —
// trending's 4h window (a future date reads as "0m ago" forever), the cluster
// representative (= newest published member), and the ±window assignment anchor.
// nowMs is injected (matching utils.ts) so the function stays pure and testable.
export function parseDate(pubDate: string | undefined, nowMs: number = Date.now()): string | null {
  if (!pubDate) return null
  const t = new Date(pubDate).getTime()
  if (isNaN(t)) return null
  if (t > nowMs + MAX_FUTURE_SKEW_MS) return null
  if (t < nowMs - MAX_PAST_AGE_MS) return null
  return new Date(t).toISOString()
}

// True when a pubDate parsed cleanly but fell outside the accepted window (i.e.
// parseDate clamped it to null). Lets the pipeline count clamps — a misconfigured
// feed — distinctly from missing/unparseable dates, for the curation pass.
export function isClampedDate(pubDate: string | undefined, nowMs: number = Date.now()): boolean {
  if (!pubDate) return false
  const t = new Date(pubDate).getTime()
  if (isNaN(t)) return false
  return t > nowMs + MAX_FUTURE_SKEW_MS || t < nowMs - MAX_PAST_AGE_MS
}

// ── Fetching ─────────────────────────────────────────────────────────────────

async function fetchXml(url: string, headers: Record<string, string>, timeoutMs: number): Promise<{ text: string; contentType: string }> {
  let response: Response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new FeedError('timeout', `timeout after ${timeoutMs}ms`)
    }
    throw new FeedError('network', err instanceof Error ? `${err.name}: ${err.message}` : String(err))
  }
  if (!response.ok) throw new FeedError('http', `HTTP ${response.status}`)
  return { text: await response.text(), contentType: response.headers.get('content-type') ?? 'unknown' }
}

// Many news-site WAFs block GitHub Actions' datacenter IPs (proven 2026-06: the
// same URLs work from residential IPs and worked from Vercel). When the proxy env
// is configured, failed direct fetches retry once through a Cloudflare Worker
// (cloudflare/feed-proxy.js) whose egress IPs are rarely blocked.
function proxyConfig(): { url: string; secret: string } | null {
  const url = process.env.FEED_PROXY_URL
  const secret = process.env.FEED_PROXY_SECRET
  return url && secret ? { url, secret } : null
}

// Cap concurrent proxy calls so the whole roster doesn't burst-fire the Worker
// from one runner. The proxy is now the PRIMARY path (proxy-first), so this is
// raised from 10 → 20: ~200 feeds × ~96 runs/day ≈ 18.5k subrequests/day, well
// under the free tier's 100k. Tiny semaphore — not worth a dependency.
const PROXY_CONCURRENCY = 20
let proxyActive = 0
const proxyWaiters: Array<() => void> = []
async function withProxySlot<T>(fn: () => Promise<T>): Promise<T> {
  while (proxyActive >= PROXY_CONCURRENCY) {
    await new Promise<void>((resolve) => proxyWaiters.push(resolve))
  }
  proxyActive++
  try {
    return await fn()
  } finally {
    proxyActive--
    proxyWaiters.shift()?.()
  }
}

function parseArticles(feed: Feed, xml: string): Promise<{ articles: ArticleInsert[]; clamped: number }> {
  const now = Date.now()
  return parser.parseString(xml).then((parsed) => {
    let clamped = 0
    const articles = parsed.items
      .map((item) => {
        if (isClampedDate(item.pubDate, now)) clamped++
        const summary = item.contentSnippet?.slice(0, 500) ?? item.summary?.slice(0, 500) ?? null
        return {
          guid: buildGuid(item),
          title: item.title?.trim() ?? '(no title)',
          url: item.link ?? feed.url,
          summary,
          published_at: parseDate(item.pubDate, now),
          source_name: feed.name,
          source_region: feed.region as SourceRegion,
          source_lang: feed.lang,
          source_affiliation: feed.affiliation ?? null,
          feed_url: feed.url,
          source_id: feed.id ?? null,
          body_hash: bodyHash(summary),
        }
      })
      .filter((a) => a.guid !== '')
    return { articles, clamped }
  })
}

// fast-xml-parser yields a bare string for text-only elements, or an object with
// '#text' (+ '@_'-prefixed attrs) when the element carries attributes. Normalize.
function textOf(node: unknown): string | undefined {
  if (node == null) return undefined
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text']
    if (typeof t === 'string') return t
    if (typeof t === 'number') return String(t)
  }
  return undefined
}

// RSS uses a plain <link> string; Atom uses <link href="…" rel="alternate"/>
// (possibly several). Prefer the alternate, else the first, else fall back to the
// guid when it's a permalink URL.
function pickLink(item: Record<string, unknown>): string | undefined {
  const link = item.link
  if (typeof link === 'string') return link
  const links = Array.isArray(link) ? link : link ? [link] : []
  const alt = links.find((l) => (l as Record<string, unknown>)?.['@_rel'] === 'alternate') ?? links[0]
  const href = (alt as Record<string, unknown>)?.['@_href']
  if (typeof href === 'string') return href
  return textOf(item.guid) ?? undefined
}

// Tolerant fallback: rss-parser threw, but the body is still XML-ish. Hand-map
// RSS2 <item> / Atom <entry> into ArticleInsert, REUSING buildGuid/parseDate/
// isClampedDate/bodyHash so guid, date-clamp and wire-hash behavior are identical.
function parseArticlesLenient(feed: Feed, xml: string): { articles: ArticleInsert[]; clamped: number } {
  const now = Date.now()
  const tree = lenientParser.parse(xml) as Record<string, any>
  const channel = tree?.rss?.channel ?? tree?.['rdf:RDF'] ?? tree?.channel
  const raw = channel?.item ?? tree?.feed?.entry ?? []
  const items: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : raw ? [raw] : []
  let clamped = 0
  const articles = items
    .map((item) => {
      const pubRaw = textOf(item.pubDate) ?? textOf(item.published) ?? textOf(item.updated) ?? textOf(item['dc:date'])
      if (isClampedDate(pubRaw, now)) clamped++
      const summaryRaw = textOf(item.description) ?? textOf(item.summary) ?? textOf(item.content)
      const summary = summaryRaw ? summaryRaw.slice(0, 500) : null
      const link = pickLink(item)
      return {
        guid: buildGuid({ guid: textOf(item.guid) ?? textOf(item.id), link }),
        title: (textOf(item.title) ?? '(no title)').trim(),
        url: link ?? feed.url,
        summary,
        published_at: parseDate(pubRaw, now),
        source_name: feed.name,
        source_region: feed.region as SourceRegion,
        source_lang: feed.lang,
        source_affiliation: feed.affiliation ?? null,
        feed_url: feed.url,
        source_id: feed.id ?? null,
        body_hash: bodyHash(summary),
      }
    })
    .filter((a) => a.guid !== '')
  return { articles, clamped }
}

// Strip a leading BOM / whitespace before parsing — a stray BOM or blank first
// line makes the strict parser throw "Non-whitespace before first tag" on an
// otherwise-valid feed (the VOA/RFE/RL /api/*/rss.xml cluster).
function stripLeading(s: string): string {
  return s.replace(/^[﻿￾\s]+/, '')
}

// Did the origin serve a non-feed (HTML challenge / soft-404 / login wall)?
// A real feed has an XML/RSS/Atom/RDF root near the top — trust that over a
// possibly-mislabeled content-type (some servers send valid RSS as text/html).
function looksLikeNonFeed(body: string, contentType: string): boolean {
  const head = body.slice(0, 1000)
  if (/<\?xml|<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(head)) return false
  const start = head.toLowerCase().trimStart()
  if (start.startsWith('<!doctype html') || start.startsWith('<html')) return true
  if (/text\/html|application\/xhtml/i.test(contentType)) return true
  // No feed root and not obviously XML ⇒ nothing parseable; label it blocked.
  return true
}

async function fetchAndParse(
  feed: Feed,
  doFetch: () => Promise<{ text: string; contentType: string }>,
): Promise<{ articles: ArticleInsert[]; clamped: number }> {
  const { text: raw, contentType } = await doFetch()
  const text = stripLeading(raw)
  const head = () => text.slice(0, 100).replace(/\s+/g, ' ')

  // The origin returned a non-feed (WAF challenge / soft-404): a distinct
  // 'blocked' kind, not a 'parse' error on a real-but-broken feed.
  if (looksLikeNonFeed(text, contentType)) {
    throw new FeedError('blocked', `non-feed response | content-type=${contentType} head="${head()}"`)
  }

  try {
    return await parseArticles(feed, text)
  } catch (err) {
    // rss-parser is strict; some valid-ish feeds carry unescaped & or stray tags.
    // Retry once with the tolerant parser before giving up.
    try {
      const lenient = parseArticlesLenient(feed, text)
      if (lenient.articles.length > 0) return lenient
    } catch {
      // fall through to the parse error
    }
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    throw new FeedError('parse', `${msg} | content-type=${contentType} head="${head()}"`)
  }
}

const fetchDirect = (feed: Feed) => fetchAndParse(feed, () => fetchXml(feed.url, FEED_HEADERS, FEED_TIMEOUT_MS))

export async function fetchFeed(feed: Feed): Promise<FeedFetchResult> {
  const proxy = proxyConfig()

  // No proxy configured ⇒ plain direct fetch (local dev / proxy-less runs).
  if (!proxy) {
    try {
      const { articles, clamped } = await fetchDirect(feed)
      return { feed, via: 'direct', articles, clamped }
    } catch (err) {
      const e = err instanceof FeedError ? err : new FeedError('network', String(err))
      return { feed, via: 'direct', articles: [], error: { kind: e.kind, detail: e.detail } }
    }
  }

  // Proxy-first: the runner's datacenter IP is WAF-blocked by most origins, so
  // the Worker (rarely-blocked egress) is the reliable path. Direct-first wasted
  // an 8s timeout on ~85% of feeds every run; direct is now only the fallback,
  // so coverage never regresses if the Worker is down.
  let proxyError: FeedError
  try {
    const { articles, clamped } = await withProxySlot(() =>
      fetchAndParse(feed, () =>
        fetchXml(
          `${proxy.url}?url=${encodeURIComponent(feed.url)}`,
          { ...FEED_HEADERS, 'x-proxy-key': proxy.secret },
          PROXY_TIMEOUT_MS,
        ),
      ),
    )
    return { feed, via: 'proxy', articles, clamped }
  } catch (err) {
    proxyError = err instanceof FeedError ? err : new FeedError('network', String(err))
  }

  try {
    const { articles, clamped } = await fetchDirect(feed)
    return { feed, via: 'direct', articles, clamped }
  } catch (err) {
    const directError = err instanceof FeedError ? err : new FeedError('network', String(err))
    // Report the PROXY failure kind — the Worker is the primary egress, so its
    // outcome is the actionable one for curation. Both details are kept.
    return {
      feed,
      via: 'proxy',
      articles: [],
      error: { kind: proxyError.kind, detail: `proxy: ${proxyError.detail} | direct: ${directError.detail}` },
    }
  }
}
