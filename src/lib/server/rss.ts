import Parser from 'rss-parser'
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
  feed_url: string
}

export type FeedErrorKind = 'http' | 'timeout' | 'parse' | 'network'

export interface FeedFetchResult {
  feed: Feed
  articles: ArticleInsert[]
  /** which path produced the result (or was attempted last on failure) */
  via: 'direct' | 'proxy'
  error?: { kind: FeedErrorKind; detail: string }
}

const FEED_TIMEOUT_MS = 8000
const FEED_HEADERS = {
  'User-Agent': 'WW3Watch/1.0 (news aggregator)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
}

const parser = new Parser()

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

// Some feeds (notably locale-formatted Persian/Arabic ones) emit pubDate strings
// that `new Date()` can't parse. `new Date('garbage').toISOString()` throws a
// RangeError — and because the throw happens inside the items .map() below, it
// used to drop the ENTIRE feed. Return null on any unparseable date instead.
export function parseDate(pubDate: string | undefined): string | null {
  if (!pubDate) return null
  const d = new Date(pubDate)
  return isNaN(d.getTime()) ? null : d.toISOString()
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

// Cap concurrent proxy calls so a ~158-feed failure wave doesn't burst-fire the
// Worker from one runner. Tiny semaphore — not worth a dependency.
const PROXY_CONCURRENCY = 10
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

function parseArticles(feed: Feed, xml: string): Promise<ArticleInsert[]> {
  return parser.parseString(xml).then((parsed) =>
    parsed.items
      .map((item) => ({
        guid: buildGuid(item),
        title: item.title?.trim() ?? '(no title)',
        url: item.link ?? feed.url,
        summary: item.contentSnippet?.slice(0, 500) ?? item.summary?.slice(0, 500) ?? null,
        published_at: parseDate(item.pubDate),
        source_name: feed.name,
        source_region: feed.region as SourceRegion,
        source_lang: feed.lang,
        feed_url: feed.url,
      }))
      .filter((a) => a.guid !== ''),
  )
}

async function fetchAndParse(
  feed: Feed,
  doFetch: () => Promise<{ text: string; contentType: string }>,
): Promise<ArticleInsert[]> {
  const { text, contentType } = await doFetch()
  try {
    return await parseArticles(feed, text)
  } catch (err) {
    // A 'parse' failure on a 200 response is often a WAF challenge page in
    // disguise — keep content-type + a snippet so telemetry can tell them apart.
    const head = text.slice(0, 100).replace(/\s+/g, ' ')
    const msg = err instanceof Error ? err.message.slice(0, 80) : String(err)
    throw new FeedError('parse', `${msg} | content-type=${contentType} head="${head}"`)
  }
}

export async function fetchFeed(feed: Feed): Promise<FeedFetchResult> {
  let directError: FeedError
  try {
    const articles = await fetchAndParse(feed, () => fetchXml(feed.url, FEED_HEADERS, FEED_TIMEOUT_MS))
    return { feed, via: 'direct', articles }
  } catch (err) {
    directError = err instanceof FeedError ? err : new FeedError('network', String(err))
  }

  // Direct failed (any kind — parse included, since WAF challenges arrive as
  // 200+HTML). Retry once through the proxy when configured.
  const proxy = proxyConfig()
  if (!proxy) {
    return { feed, via: 'direct', articles: [], error: { kind: directError.kind, detail: directError.detail } }
  }

  try {
    const articles = await withProxySlot(() =>
      fetchAndParse(feed, () =>
        fetchXml(
          `${proxy.url}?url=${encodeURIComponent(feed.url)}`,
          { 'x-proxy-key': proxy.secret, Accept: FEED_HEADERS.Accept },
          FEED_TIMEOUT_MS + 4000, // proxy adds a hop; give it headroom
        ),
      ),
    )
    return { feed, via: 'proxy', articles }
  } catch (err) {
    const proxyError = err instanceof FeedError ? err : new FeedError('network', String(err))
    return {
      feed,
      via: 'proxy',
      articles: [],
      error: { kind: proxyError.kind, detail: `direct: ${directError.detail} | proxy: ${proxyError.detail}` },
    }
  }
}
