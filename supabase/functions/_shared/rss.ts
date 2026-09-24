// Pure RSS 2.0 builder for the public feed (functions/rss). No deps so it stays
// deno-checkable + unit-testable; the function file owns the DB query + headers.
// LLMs route/translate — they never emit this load-bearing structure (constitution).

export interface FeedItem {
  /** stable, opaque guid (the article id) */
  id: string
  title: string
  /** absolute link — the app deep-link, so the item opens in WW3Watch's reader */
  url: string
  summary: string | null
  /** ISO timestamp, or null when the source published no date */
  publishedAt: string | null
  sourceName: string
  region: string
}

export interface FeedMeta {
  /** the app's canonical site URL */
  siteUrl: string
  /** this feed's own URL (atom:link rel=self) */
  feedUrl: string
  /** ISO timestamp for lastBuildDate (typically the newest item) */
  buildDate: string
}

// XML text escaping. '&' first so we don't double-escape the entities we emit.
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// RFC-822 date for pubDate/lastBuildDate. Returns '' for an invalid/empty input
// so the caller can omit the element rather than emit a broken date.
export function rfc822(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toUTCString()
}

export function buildRssXml(items: FeedItem[], meta: FeedMeta): string {
  const entries = items
    .map((it) => {
      const pub = rfc822(it.publishedAt)
      const desc = [it.summary?.trim(), `— ${it.sourceName} (${it.region})`]
        .filter(Boolean)
        .join(' ')
      return [
        '    <item>',
        `      <title>${xmlEscape(it.title)}</title>`,
        `      <link>${xmlEscape(it.url)}</link>`,
        `      <guid isPermaLink="false">${xmlEscape(it.id)}</guid>`,
        pub ? `      <pubDate>${pub}</pubDate>` : '',
        `      <category>${xmlEscape(it.region)}</category>`,
        `      <description>${xmlEscape(desc)}</description>`,
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  // Epoch fallback keeps lastBuildDate present even if buildDate is unparseable.
  const build = rfc822(meta.buildDate) || new Date(0).toUTCString()

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>WW3Watch — Real-time global conflict tracker</title>
    <link>${xmlEscape(meta.siteUrl)}</link>
    <atom:link href="${xmlEscape(meta.feedUrl)}" rel="self" type="application/rss+xml" />
    <description>Latest stories from WW3Watch: global conflict news aggregated across 200+ sources and languages.</description>
    <language>en</language>
    <lastBuildDate>${build}</lastBuildDate>
    <ttl>15</ttl>
${entries}
  </channel>
</rss>`
}
