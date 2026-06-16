import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { buildRssXml, rfc822, xmlEscape, type FeedItem } from './rss.ts'

const META = {
  siteUrl: 'https://noahsabaj.github.io/ww3watch',
  feedUrl: 'https://example.supabase.co/functions/v1/rss',
  buildDate: '2026-06-16T12:00:00Z',
}

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'a-1',
    title: 'Headline',
    url: 'https://noahsabaj.github.io/ww3watch/?article=a-1',
    summary: 'A summary.',
    publishedAt: '2026-06-16T11:00:00Z',
    sourceName: 'Reuters',
    region: 'US/Western',
    ...overrides,
  }
}

Deno.test('xmlEscape escapes all five XML metacharacters, ampersand-first', () => {
  assertEquals(xmlEscape(`a & b < c > d " e ' f`), 'a &amp; b &lt; c &gt; d &quot; e &apos; f')
  // No double-escaping of the entities we just produced.
  assertEquals(xmlEscape('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;')
})

Deno.test('rfc822 formats valid dates and rejects junk/empty', () => {
  assertEquals(rfc822('2026-06-16T12:00:00Z'), 'Tue, 16 Jun 2026 12:00:00 GMT')
  assertEquals(rfc822(null), '')
  assertEquals(rfc822('not a date'), '')
})

Deno.test('buildRssXml emits a well-formed channel with item elements', () => {
  const xml = buildRssXml([item(), item({ id: 'a-2', title: 'Second' })], META)
  assertStringIncludes(xml, '<?xml version="1.0" encoding="UTF-8"?>')
  assertStringIncludes(xml, '<rss version="2.0"')
  assertStringIncludes(xml, '<atom:link href="https://example.supabase.co/functions/v1/rss" rel="self"')
  assertStringIncludes(xml, '<lastBuildDate>Tue, 16 Jun 2026 12:00:00 GMT</lastBuildDate>')
  // One <item> per feed entry.
  assertEquals(xml.match(/<item>/g)?.length, 2)
  assertStringIncludes(xml, '<guid isPermaLink="false">a-2</guid>')
  assertStringIncludes(xml, '<pubDate>Tue, 16 Jun 2026 11:00:00 GMT</pubDate>')
  assertStringIncludes(xml, '<category>US/Western</category>')
  assertStringIncludes(xml, '— Reuters (US/Western)')
})

Deno.test('buildRssXml escapes hostile titles/summaries (no XML injection)', () => {
  const xml = buildRssXml(
    [item({ title: 'War & <peace> "talks"', summary: `O'Brien said <b>x</b>` })],
    META,
  )
  assertStringIncludes(xml, '<title>War &amp; &lt;peace&gt; &quot;talks&quot;</title>')
  // The raw closing tag must not appear inside the description.
  assert(!xml.includes('<b>x</b>'))
  assertStringIncludes(xml, 'O&apos;Brien said &lt;b&gt;x&lt;/b&gt;')
})

Deno.test('buildRssXml omits pubDate for an undated item but still renders it', () => {
  const xml = buildRssXml([item({ publishedAt: null })], META)
  assertEquals(xml.match(/<item>/g)?.length, 1)
  assert(!xml.includes('<pubDate>'))
})

Deno.test('buildRssXml falls back to epoch lastBuildDate on a bad buildDate', () => {
  const xml = buildRssXml([item()], { ...META, buildDate: 'garbage' })
  assertStringIncludes(xml, `<lastBuildDate>${new Date(0).toUTCString()}</lastBuildDate>`)
})
