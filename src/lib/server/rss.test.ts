// src/lib/server/rss.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildGuid, fetchFeed } from './rss'
import type { Feed } from '../types'

const mockFeed: Feed = { name: 'Test', url: 'https://example.com/rss', region: 'US/Western', lang: 'en' }

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
})

describe('fetchFeed', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'))
    const result = await fetchFeed(mockFeed)
    expect(result).toEqual([])
  })

  it('returns empty array on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    )
    const result = await fetchFeed(mockFeed)
    expect(result).toEqual([])
  })

  it('returns empty array on AbortError (timeout)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError')
    )
    const result = await fetchFeed(mockFeed)
    expect(result).toEqual([])
  })

  it('returns parsed articles from valid RSS', async () => {
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
      new Response(rssXml, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } })
    )
    const result = await fetchFeed(mockFeed)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Test Article')
    expect(result[0].url).toBe('https://example.com/article-1')
    expect(result[0].guid).toBe('https://example.com/article-1')
    expect(result[0].source_name).toBe('Test')
    expect(result[0].source_region).toBe('US/Western')
    expect(result[0].source_lang).toBe('en')
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(rssXml, { status: 200 })
    )
    const result = await fetchFeed(mockFeed)
    expect(result).toHaveLength(0)
  })
})
