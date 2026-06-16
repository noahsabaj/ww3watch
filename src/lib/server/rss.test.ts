// src/lib/server/rss.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildGuid, fetchFeed, parseDate, isClampedDate } from './rss'
import type { Feed } from '../types'

const mockFeed: Feed = { name: 'Test', url: 'https://example.com/rss', region: 'US/Western', lang: 'en' }

describe('parseDate', () => {
  // Fixed reference instant so clamp boundaries are deterministic no matter when
  // the suite runs (the old fixed-date fixture became a time bomb in 2027).
  const NOW = Date.parse('2026-06-12T00:00:00.000Z')
  const DAY = 24 * 3600_000
  const at = (offsetMs: number) => new Date(NOW + offsetMs).toUTCString()

  it('returns null for missing date', () => {
    expect(parseDate(undefined, NOW)).toBeNull()
  })

  it('returns null for an unparseable date (instead of throwing)', () => {
    expect(parseDate('۱۴۰۳/۱۲/۱۵', NOW)).toBeNull()
    expect(parseDate('not a date', NOW)).toBeNull()
  })

  it('returns an ISO string for an in-range date', () => {
    expect(parseDate('Mon, 03 Mar 2026 10:00:00 GMT', NOW)).toBe('2026-03-03T10:00:00.000Z')
  })

  it('clamps a far-future date to null (broken feed timezone/year)', () => {
    expect(parseDate(at(2 * DAY), NOW)).toBeNull()
  })

  it('tolerates a few minutes of future clock skew', () => {
    expect(parseDate(at(5 * 60_000), NOW)).not.toBeNull()
  })

  it('clamps an ancient date (>1 year old) to null', () => {
    expect(parseDate(at(-400 * DAY), NOW)).toBeNull()
  })

  it('keeps a date within the last year', () => {
    expect(parseDate(at(-30 * DAY), NOW)).not.toBeNull()
  })
})

describe('isClampedDate', () => {
  const NOW = Date.parse('2026-06-12T00:00:00.000Z')
  const DAY = 24 * 3600_000
  const at = (offsetMs: number) => new Date(NOW + offsetMs).toUTCString()

  it('is false for missing or unparseable dates', () => {
    expect(isClampedDate(undefined, NOW)).toBe(false)
    expect(isClampedDate('not a date', NOW)).toBe(false)
  })

  it('is false for an in-range date', () => {
    expect(isClampedDate(at(-DAY), NOW)).toBe(false)
  })

  it('is true for far-future and ancient dates', () => {
    expect(isClampedDate(at(2 * DAY), NOW)).toBe(true)
    expect(isClampedDate(at(-400 * DAY), NOW)).toBe(true)
  })
})

describe('buildGuid', () => {
  it('returns guid if present', () => {
    expect(buildGuid({ guid: 'unique-123', link: 'https://example.com/article' })).toBe('unique-123')
  })

  it('falls back to link if guid is missing', () => {
    expect(buildGuid({ link: 'https://example.com/article' })).toBe('https://example.com/article')
  })

  it('returns empty string if both missing', () => {
    expect(buildGuid({})).toBe('')
  })

  it('extracts text when rss-parser returns guid as an object (XML attrs)', () => {
    // rss-parser shape for <guid isPermaLink="false">id-9</guid>
    expect(buildGuid({ guid: { _: 'id-9', $: { isPermaLink: 'false' } }, link: 'https://x/y' })).toBe('id-9')
  })

  it('falls back to link when guid is an empty/garbage object', () => {
    expect(buildGuid({ guid: { $: { isPermaLink: 'false' } }, link: 'https://x/y' })).toBe('https://x/y')
  })
})

describe('fetchFeed', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // No proxy env in tests, so failures return empty (no proxy retry).
    delete process.env.FEED_PROXY_URL
    delete process.env.FEED_PROXY_SECRET
  })

  it('classifies a network error (no articles, kind=network)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'))
    const result = await fetchFeed(mockFeed)
    expect(result.articles).toEqual([])
    expect(result.error?.kind).toBe('network')
  })

  it('classifies a non-200 response (kind=http with status)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
    const result = await fetchFeed(mockFeed)
    expect(result.articles).toEqual([])
    expect(result.error?.kind).toBe('http')
    expect(result.error?.detail).toContain('404')
  })

  it('classifies an AbortError/timeout (kind=timeout)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError'),
    )
    const result = await fetchFeed(mockFeed)
    expect(result.articles).toEqual([])
    expect(result.error?.kind).toBe('timeout')
  })

  it('classifies a WAF challenge / non-feed HTML as kind=blocked (not parse)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html><body>Just a moment... (WAF challenge)</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const result = await fetchFeed(mockFeed)
    expect(result.articles).toEqual([])
    expect(result.error?.kind).toBe('blocked')
    expect(result.error?.detail).toContain('content-type=text/html')
  })

  it('sends a browser User-Agent + Accept-Language (direct path)', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<rss version="2.0"><channel><title>T</title></channel></rss>', { status: 200 }))
    await fetchFeed(mockFeed)
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['User-Agent']).toContain('Mozilla/5.0')
    expect(headers['User-Agent']).toContain('Chrome/')
    expect(headers['Accept-Language']).toBe('en-US,en;q=0.9')
  })

  it('tolerates a leading-whitespace feed (Non-whitespace-before-first-tag cluster)', async () => {
    const rssXml = `\n\n   <?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
      <item><title>Lead ws</title><link>https://x/1</link><guid>https://x/1</guid></item></channel></rss>`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(rssXml, { status: 200, headers: { 'Content-Type': 'application/xml' } }),
    )
    const result = await fetchFeed(mockFeed)
    expect(result.error).toBeUndefined()
    expect(result.articles).toHaveLength(1)
  })

  it('recovers a malformed-but-XML feed via the tolerant fallback parser', async () => {
    // `&nbsp;` is undefined in XML → rss-parser (strict sax) throws; fast-xml-parser
    // (htmlEntities) tolerates it, so the item is still ingested.
    const rssXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
      <item><title>Iran&nbsp;talks resume</title><link>https://x/1</link><guid>https://x/1</guid></item></channel></rss>`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(rssXml, { status: 200, headers: { 'Content-Type': 'application/xml' } }),
    )
    const result = await fetchFeed(mockFeed)
    expect(result.error).toBeUndefined()
    expect(result.articles).toHaveLength(1)
    expect(result.articles[0].guid).toBe('https://x/1')
    expect(result.articles[0].title).toContain('Iran')
  })

  it('returns parsed articles from valid RSS (via direct, no error)', async () => {
    const rssXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Test Article</title>
      <link>https://example.com/article-1</link>
      <guid>https://example.com/article-1</guid>
      <pubDate>Mon, 03 Mar 2026 10:00:00 GMT</pubDate>
      <description>Test summary here.</description>
    </item>
  </channel>
</rss>`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(rssXml, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
    )
    const result = await fetchFeed(mockFeed)
    expect(result.error).toBeUndefined()
    expect(result.via).toBe('direct')
    expect(result.articles).toHaveLength(1)
    expect(result.articles[0].title).toBe('Test Article')
    expect(result.articles[0].guid).toBe('https://example.com/article-1')
    expect(result.articles[0].source_name).toBe('Test')
  })

  it('keeps the feed when an item has an unparseable pubDate (regression)', async () => {
    const rssXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Bad date item</title>
      <link>https://example.com/article-bad-date</link>
      <guid>https://example.com/article-bad-date</guid>
      <pubDate>۱۴۰۳/۱۲/۱۵ - garbage</pubDate>
    </item>
  </channel>
</rss>`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(rssXml, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } }),
    )
    const result = await fetchFeed(mockFeed)
    expect(result.articles).toHaveLength(1) // previously this threw and dropped the whole feed
    expect(result.articles[0].published_at).toBeNull()
  })

  it('fetches PROXY-FIRST when proxy env is set (first call hits the proxy)', async () => {
    process.env.FEED_PROXY_URL = 'https://proxy.example/fetch'
    process.env.FEED_PROXY_SECRET = 'secret'
    const rssXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
      <item><title>Proxied</title><link>https://x/1</link><guid>https://x/1</guid></item></channel></rss>`
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(rssXml, { status: 200, headers: { 'Content-Type': 'application/xml' } }))
    const result = await fetchFeed(mockFeed)
    expect(result.via).toBe('proxy')
    expect(result.articles).toHaveLength(1)
    expect(result.articles[0].title).toBe('Proxied')
    // The FIRST call went to the proxy URL with the secret header.
    const firstCall = spy.mock.calls[0]
    expect(String(firstCall[0])).toContain('proxy.example')
    expect((firstCall[1] as RequestInit).headers).toMatchObject({ 'x-proxy-key': 'secret' })
  })

  it('falls back to a direct fetch when the proxy fails', async () => {
    process.env.FEED_PROXY_URL = 'https://proxy.example/fetch'
    process.env.FEED_PROXY_SECRET = 'secret'
    const rssXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
      <item><title>Direct fallback</title><link>https://x/1</link><guid>https://x/1</guid></item></channel></rss>`
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('proxy down'))
      .mockResolvedValueOnce(new Response(rssXml, { status: 200, headers: { 'Content-Type': 'application/xml' } }))
    const result = await fetchFeed(mockFeed)
    expect(result.via).toBe('direct')
    expect(result.articles).toHaveLength(1)
    expect(String(spy.mock.calls[0][0])).toContain('proxy.example') // proxy tried first
    expect(String(spy.mock.calls[1][0])).toBe(mockFeed.url) // then direct
  })

  it('reports the PROXY error kind (not direct) when both paths fail', async () => {
    process.env.FEED_PROXY_URL = 'https://proxy.example/fetch'
    process.env.FEED_PROXY_SECRET = 'secret'
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('blocked', { status: 403 })) // proxy → http
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError')) // direct → timeout
    const result = await fetchFeed(mockFeed)
    expect(result.articles).toEqual([])
    expect(result.error?.kind).toBe('http') // the proxy (decisive) kind, not 'timeout'
    expect(result.error?.detail).toContain('proxy: HTTP 403')
    expect(result.error?.detail).toContain('direct: timeout')
  })

  it('skips items with no guid and no link', async () => {
    const rssXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>No identifier</title>
    </item>
  </channel>
</rss>`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(rssXml, { status: 200 }))
    const result = await fetchFeed(mockFeed)
    expect(result.articles).toHaveLength(0)
  })
})
