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

  it('classifies a parse failure (kind=parse) and includes a snippet', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('<html><body>Just a moment... (WAF challenge)</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const result = await fetchFeed(mockFeed)
    expect(result.articles).toEqual([])
    expect(result.error?.kind).toBe('parse')
    expect(result.error?.detail).toContain('content-type=text/html')
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

  it('retries through the proxy when direct fails and proxy env is set', async () => {
    process.env.FEED_PROXY_URL = 'https://proxy.example/fetch'
    process.env.FEED_PROXY_SECRET = 'secret'
    const rssXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
      <item><title>Proxied</title><link>https://x/1</link><guid>https://x/1</guid></item></channel></rss>`
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('direct blocked'))
      .mockResolvedValueOnce(new Response(rssXml, { status: 200, headers: { 'Content-Type': 'application/xml' } }))
    const result = await fetchFeed(mockFeed)
    expect(result.via).toBe('proxy')
    expect(result.articles).toHaveLength(1)
    expect(result.articles[0].title).toBe('Proxied')
    // second call went to the proxy URL with the secret header
    const secondCall = spy.mock.calls[1]
    expect(String(secondCall[0])).toContain('proxy.example')
    expect((secondCall[1] as RequestInit).headers).toMatchObject({ 'x-proxy-key': 'secret' })
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
