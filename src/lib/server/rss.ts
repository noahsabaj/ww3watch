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

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent': 'WW3Watch/1.0 (news aggregator)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
  }
})

export function buildGuid(item: { guid?: string; link?: string }): string {
  return item.guid ?? item.link ?? ''
}

export async function fetchFeed(feed: Feed): Promise<ArticleInsert[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'WW3Watch/1.0 (news aggregator)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    })

    if (!response.ok) return []

    const xml = await response.text()
    const parsed = await parser.parseString(xml)

    return parsed.items
      .map(item => ({
        guid:          buildGuid(item),
        title:         item.title?.trim() ?? '(no title)',
        url:           item.link ?? feed.url,
        summary:       item.contentSnippet?.slice(0, 500) ?? item.summary?.slice(0, 500) ?? null,
        published_at:  item.pubDate ? new Date(item.pubDate).toISOString() : null,
        source_name:   feed.name,
        source_region: feed.region as SourceRegion,
        source_lang:   feed.lang,
        feed_url:      feed.url,
      }))
      .filter(a => a.guid !== '')
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
