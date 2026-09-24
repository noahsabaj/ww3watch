import Parser from 'rss-parser'
import { XMLParser } from 'fast-xml-parser'
import { bodyHash } from './wire'
import { dropChannelLogos, pickFeedImage } from './image'
import type { Feed, SourceRegion } from '../types'

export type ArticleInsert = {
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
  image_url: string | null
  image_width: number | null
  image_height: number | null
  image_fetched_at: string | null
}

// 'blocked' = the origin served a non-feed (WAF "Just a moment…" challenge,
// login wall, soft-404) — distinct from 'parse' (a real but malformed feed) so
// curation can tell "needs a UA/unblock" from "needs a feed fix". Exported as a
// const array so the pipeline's per-kind tally can't drift from this list.
export const FEED_ERROR_KINDS = ['http', 'timeout', 'parse', 'network', 'blocked'] as const
export type FeedErrorKind = (typeof FEED_ERROR_KINDS)[number]

/** A feed's cache validators from its last full response (sources.feed_etag,
 *  sources.feed_last_modified), sent back as If-None-Match / If-Modified-Since. */
export interface Validators {
  etag: string | null
  lastModified: string | null
}
export const NO_VALIDATORS: Validators = { etag: null, lastModified: null }

export interface FeedFetchResult {
  feed: Feed
  articles: ArticleInsert[]
  /** The feed answered 304: nothing changed since the validators we sent. */
  notModified?: boolean
  /** What to send next run (absent on failure: keep the stored ones). */
  validators?: Validators
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

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['media:group', 'mediaGroup'],
    ],
  },
})
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

// Feeds whose date strings carry the wrong UTC offset: the clock time is right
// for the zone named here, whatever offset the string states. Checked on
// 2026-09-24 against each article page's own time (JSON-LD or meta):
//   - Al Jazeera Arabic writes UTC and labels it +0300, so every report looked
//     three hours old on arrival and ranked lower (all 363 in a week).
//   - Walla writes Israel time, Hurriyet Daily News Turkish time and Qatar News
//     Agency Doha time, each labelled GMT or Z. Their reports looked hours in
//     the future and lost their date (84 of Walla's 91 in a week, 66 of QNA's
//     84), and an undated report never reaches the feed.
const FEED_CLOCK_ZONES: Record<string, string> = {
  'www.aljazeera.net': 'UTC',
  'rss.walla.co.il': 'Asia/Jerusalem',
  'www.hurriyetdailynews.com': 'Europe/Istanbul',
  'qna.org.qa': 'Asia/Qatar',
}

export function feedClockZone(feedUrl: string): string | undefined {
  try {
    return FEED_CLOCK_ZONES[new URL(feedUrl).hostname]
  } catch {
    return undefined
  }
}

// How far `zone`'s clocks are ahead of UTC at an instant.
function zoneOffsetMs(zone: string, atMs: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    })
      .formatToParts(new Date(atMs))
      .map((p) => [p.type, Number(p.value)]),
  )
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - (atMs - (atMs % 1000))
}

// The instant a feed's date string names. With a zone, the string's clock time
// is read in that zone and its stated offset ignored.
function instantOf(raw: string, zone?: string): number {
  if (!zone) return new Date(raw).getTime()
  const s = raw.trim()
  // "2026-09-24T02:40:11+03:00" | "Thu, 24 Sep 2026 02:40:11 +0300" (or GMT, Z)
  const clock = /^\d{4}-\d{2}-\d{2}T/.test(s)
    ? Date.parse(s.replace(/(?:Z|[+-]\d{2}:?\d{2})$/i, '') + 'Z')
    : Date.parse(s.replace(/\s+(?:[+-]\d{4}|[A-Z]{1,5})$/i, '') + ' GMT')
  if (isNaN(clock)) return NaN
  // Twice, so a time next to a daylight-saving change settles on its own offset.
  return clock - zoneOffsetMs(zone, clock - zoneOffsetMs(zone, clock))
}

// Some feeds (notably locale-formatted Persian/Arabic ones) emit pubDate strings
// that `new Date()` can't parse. `new Date('garbage').toISOString()` throws a
// RangeError — and because the throw happens inside the items .map() below, it
// used to drop the ENTIRE feed. Return null on any unparseable date instead.
//
// A future date becomes the time we read the feed: nothing was published after
// we first saw it, and a date left in the future poisons every recency calc —
// trending's 4h window ("0m ago" forever), the cluster representative (= newest
// published member), and the ±window assignment anchor. It used to become null,
// which kept the report out of the feed entirely: Taipei Times stamps a whole
// edition with the next morning, and Jerusalem Post runs over an hour ahead.
// An ancient date (a broken year, an archive item) still becomes null.
// nowMs is injected (matching utils.ts) so the function stays pure and testable.
export function parseDate(pubDate: string | undefined, nowMs: number = Date.now(), zone?: string): string | null {
  if (!pubDate) return null
  const t = instantOf(pubDate, zone)
  if (isNaN(t)) return null
  if (t > nowMs + MAX_FUTURE_SKEW_MS) return new Date(nowMs).toISOString()
  if (t < nowMs - MAX_PAST_AGE_MS) return null
  return new Date(t).toISOString()
}

// True when a pubDate parsed cleanly but fell outside the accepted window (i.e.
// parseDate replaced it). Lets the pipeline count clamps — a misconfigured
// feed — distinctly from missing/unparseable dates, for the curation pass.
export function isClampedDate(pubDate: string | undefined, nowMs: number = Date.now(), zone?: string): boolean {
  if (!pubDate) return false
  const t = instantOf(pubDate, zone)
  if (isNaN(t)) return false
  return t > nowMs + MAX_FUTURE_SKEW_MS || t < nowMs - MAX_PAST_AGE_MS
}

// A report with no usable date gets the time we first saw it (runs are minutes
// apart; Nikkei Asia's feed has no dates at all). Not on a feed's first fetch,
// when its whole backlog is new to us at once: that stays undated.
function itemDate(raw: string | undefined, feed: Feed, nowMs: number, zone?: string): string | null {
  if (raw && !isNaN(instantOf(raw, zone))) return parseDate(raw, nowMs, zone)
  return feed.last_ok_at ? new Date(nowMs).toISOString() : null
}

// ── Fetching ─────────────────────────────────────────────────────────────────

// Conditional requests: about 40% of the roster answers 304 Not Modified to a
// repeat request carrying its validators (69 of 169 feeds, surveyed
// 2026-09-23), which skips downloading, parsing and de-duplicating a feed that
// has not changed since the last run. Feeds that send neither header are
// fetched in full as before.
function conditionalHeaders(v: Validators): Record<string, string> {
  const h: Record<string, string> = {}
  if (v.etag) h['If-None-Match'] = v.etag
  if (v.lastModified) h['If-Modified-Since'] = v.lastModified
  return h
}

function validatorsOf(response: Response, fallback: Validators): Validators {
  return {
    etag: response.headers.get('etag')?.slice(0, 500) ?? fallback.etag,
    lastModified: response.headers.get('last-modified')?.slice(0, 100) ?? fallback.lastModified,
  }
}

type Fetched =
  | { notModified: true; validators: Validators }
  | { notModified?: false; text: string; contentType: string; validators: Validators }

async function fetchXml(url: string, headers: Record<string, string>, timeoutMs: number, sent: Validators = NO_VALIDATORS): Promise<Fetched> {
  let response: Response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new FeedError('timeout', `timeout after ${timeoutMs}ms`)
    }
    throw new FeedError('network', err instanceof Error ? `${err.name}: ${err.message}` : String(err))
  }
  if (response.status === 304 && (sent.etag || sent.lastModified)) {
    await response.body?.cancel().catch(() => {})
    return { notModified: true, validators: validatorsOf(response, sent) }
  }
  if (!response.ok) throw new FeedError('http', `HTTP ${response.status}`)
  return {
    text: await response.text(),
    contentType: response.headers.get('content-type') ?? 'unknown',
    // A full response's own headers only: a feed that stopped sending them
    // stops getting conditional requests.
    validators: validatorsOf(response, NO_VALIDATORS),
  }
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
// raised from 10 → 20. Feeds are ~174 proxy requests a run: at a run every 5
// minutes ≈ 50k/day, plus ~11k/day of page and photo fetches that scale with
// articles, not runs — ~61% of the free tier's 100k. Tiny semaphore — not worth a dependency.
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

function articleUrl(link: string | undefined, feedUrl: string): string {
  try {
    const url = new URL(link || feedUrl, feedUrl)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch { return '' }
}

function imageFields(item: unknown, url: string, fetchedAt: string): {
  image_url: string | null
  image_width: number | null
  image_height: number | null
  image_fetched_at: string | null
} {
  const img = url ? pickFeedImage(item, url) : null
  if (!img) return { image_url: null, image_width: null, image_height: null, image_fetched_at: null }
  return {
    image_url: img.url,
    image_width: img.width,
    image_height: img.height,
    image_fetched_at: fetchedAt,
  }
}

// WordPress appends "The post <title> appeared first on <site>." to every feed
// excerpt (194 summaries from 9 outlets over a week). It is boilerplate, not
// the story, and a phone story without a photo shows the summary in full.
const WP_FOOTER = /\s*The post [\s\S]{1,400}? appeared first on [\s\S]*$/

export function feedSummary(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const text = raw.replace(WP_FOOTER, '').trim()
  return text ? text.slice(0, 500) : null
}

function parseArticles(feed: Feed, xml: string): Promise<{ articles: ArticleInsert[]; clamped: number }> {
  const now = Date.now()
  const fetchedAt = new Date(now).toISOString()
  const zone = feedClockZone(feed.url)
  return parser.parseString(xml).then((parsed) => {
    let clamped = 0
    const articles = parsed.items
      .map((item) => {
        // RDF feeds such as DW expose dc:date as isoDate, without pubDate.
        const published = item.pubDate ?? item.isoDate
        if (isClampedDate(published, now, zone)) clamped++
        const summary = feedSummary(item.contentSnippet ?? item.summary)
        const url = articleUrl(item.link, feed.url)
        return {
          guid: buildGuid(item),
          title: item.title?.trim() ?? '(no title)',
          url,
          summary,
          published_at: itemDate(published, feed, now, zone),
          source_name: feed.name,
          source_region: feed.region as SourceRegion,
          source_lang: feed.lang,
          source_affiliation: feed.affiliation ?? null,
          feed_url: feed.url,
          source_id: feed.id ?? null,
          body_hash: bodyHash(summary),
          ...imageFields(item, url, fetchedAt),
        }
      })
      .filter((a) => a.guid !== '' && a.url !== '')
    dropChannelLogos(articles)
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
  const fetchedAt = new Date(now).toISOString()
  const zone = feedClockZone(feed.url)
  const tree = lenientParser.parse(xml) as Record<string, any>
  const channel = tree?.rss?.channel ?? tree?.['rdf:RDF'] ?? tree?.channel
  const raw = channel?.item ?? tree?.feed?.entry ?? []
  const items: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : raw ? [raw] : []
  let clamped = 0
  const articles = items
    .map((item) => {
      const pubRaw = textOf(item.pubDate) ?? textOf(item.published) ?? textOf(item.updated) ?? textOf(item['dc:date'])
      if (isClampedDate(pubRaw, now, zone)) clamped++
      const summary = feedSummary(textOf(item.description) ?? textOf(item.summary) ?? textOf(item.content))
      const link = pickLink(item)
      const url = articleUrl(link, feed.url)
      return {
        guid: buildGuid({ guid: textOf(item.guid) ?? textOf(item.id), link }),
        title: (textOf(item.title) ?? '(no title)').trim(),
        url,
        summary,
        published_at: itemDate(pubRaw, feed, now, zone),
        source_name: feed.name,
        source_region: feed.region as SourceRegion,
        source_lang: feed.lang,
        source_affiliation: feed.affiliation ?? null,
        feed_url: feed.url,
        source_id: feed.id ?? null,
        body_hash: bodyHash(summary),
        ...imageFields(item, url, fetchedAt),
      }
    })
    .filter((a) => a.guid !== '' && a.url !== '')
  dropChannelLogos(articles)
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

type Parsed = { articles: ArticleInsert[]; clamped: number; notModified?: boolean; validators: Validators }

async function fetchAndParse(feed: Feed, doFetch: () => Promise<Fetched>): Promise<Parsed> {
  const fetched = await doFetch()
  if (fetched.notModified) return { articles: [], clamped: 0, notModified: true, validators: fetched.validators }
  const { text: raw, contentType, validators } = fetched
  const text = stripLeading(raw)
  const head = () => text.slice(0, 100).replace(/\s+/g, ' ')

  // The origin returned a non-feed (WAF challenge / soft-404): a distinct
  // 'blocked' kind, not a 'parse' error on a real-but-broken feed.
  if (looksLikeNonFeed(text, contentType)) {
    throw new FeedError('blocked', `non-feed response | content-type=${contentType} head="${head()}"`)
  }

  try {
    return { ...(await parseArticles(feed, text)), validators }
  } catch (err) {
    // rss-parser is strict; some valid-ish feeds carry unescaped & or stray tags.
    // Retry once with the tolerant parser before giving up.
    try {
      const lenient = parseArticlesLenient(feed, text)
      if (lenient.articles.length > 0) return { ...lenient, validators }
    } catch {
      // fall through to the parse error
    }
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    throw new FeedError('parse', `${msg} | content-type=${contentType} head="${head()}"`)
  }
}

const fetchDirect = (feed: Feed, sent: Validators) =>
  fetchAndParse(feed, () => fetchXml(feed.url, { ...FEED_HEADERS, ...conditionalHeaders(sent) }, FEED_TIMEOUT_MS, sent))

export async function fetchFeed(feed: Feed, sent: Validators = NO_VALIDATORS): Promise<FeedFetchResult> {
  const proxy = proxyConfig()

  // No proxy configured ⇒ plain direct fetch (local dev / proxy-less runs).
  if (!proxy) {
    try {
      const { articles, clamped, notModified, validators } = await fetchDirect(feed, sent)
      return { feed, via: 'direct', articles, clamped, notModified, validators }
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
    const { articles, clamped, notModified, validators } = await withProxySlot(() =>
      fetchAndParse(feed, () =>
        fetchXml(
          `${proxy.url}?url=${encodeURIComponent(feed.url)}`,
          { ...FEED_HEADERS, ...conditionalHeaders(sent), 'x-proxy-key': proxy.secret },
          PROXY_TIMEOUT_MS,
          sent,
        ),
      ),
    )
    return { feed, via: 'proxy', articles, clamped, notModified, validators }
  } catch (err) {
    proxyError = err instanceof FeedError ? err : new FeedError('network', String(err))
  }

  try {
    const { articles, clamped, notModified, validators } = await fetchDirect(feed, sent)
    return { feed, via: 'direct', articles, clamped, notModified, validators }
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
