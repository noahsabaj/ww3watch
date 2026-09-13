import { assertEquals, assert } from 'jsr:@std/assert@1'
import { fallbackArticle, linkDensity, looksLikeJunk, htmlToText, bodyToHtml } from './extract.ts'

const PROSE = 'The ceasefire talks resumed in Doha on Tuesday after a week of shelling along the border. '.repeat(4)

Deno.test('htmlToText strips tags and decodes entities', () => {
  assertEquals(htmlToText('<p>Tom &amp; Jerry &#39;live&#39; &#x41;</p>'), "Tom & Jerry 'live' A")
})

Deno.test('linkDensity is the share of text inside anchors', () => {
  const html = '<div><a href="/a">one two three four</a> five six seven eight</div>'
  const d = linkDensity(html)
  assert(d > 0.45 && d < 0.55, `got ${d}`)
  assertEquals(linkDensity('<p>no links here</p>'), 0)
})

Deno.test('looksLikeJunk flags link lists and near-empty extractions', () => {
  const navList = '<ul>' + '<li><a href="/x">Section headline goes here</a></li>'.repeat(20) + '</ul>'
  assert(looksLikeJunk(navList, htmlToText(navList).length))
  assert(looksLikeJunk(`<p>${PROSE}</p>`, 50))
  assert(!looksLikeJunk(`<p>${PROSE}</p><p>See <a href="/r">related</a>.</p>`, PROSE.length))
})

Deno.test('fallbackArticle reads a NewsArticle articleBody, headline and author', () => {
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: 'Talks resume in Doha',
    author: [{ '@type': 'Person', name: 'A. Reporter' }],
    articleBody: `${PROSE}\n\nSecond paragraph <with> angle brackets.`,
  })
  const html = `<html><head><script type="application/ld+json">${ld}</script></head><body><nav>menu</nav></body></html>`
  const out = fallbackArticle(html)
  assert(out)
  assertEquals(out.title, 'Talks resume in Doha')
  assertEquals(out.byline, 'A. Reporter')
  assert(out.content.startsWith('<p>The ceasefire'))
  assert(out.content.includes('&lt;with&gt;'))
  assertEquals(out.content.match(/<p>/g)?.length, 2)
})

Deno.test('fallbackArticle walks @graph and arrays, and skips bodies that are too short', () => {
  const graph = JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['Article', 'Thing'], articleBody: PROSE }] })
  const short = JSON.stringify({ '@type': 'NewsArticle', articleBody: 'too short' })
  const html = `<script type='application/ld+json'>${short}</script><script type="application/ld+json">${graph}</script>`
  const out = fallbackArticle(html)
  assert(out)
  assertEquals(out.title, '')
  assertEquals(out.byline, null)
})

Deno.test('fallbackArticle survives malformed JSON-LD and returns null without a body', () => {
  assertEquals(fallbackArticle('<script type="application/ld+json">{not json</script>'), null)
  assertEquals(fallbackArticle('<script type="application/ld+json">{"@type":"NewsArticle","headline":"x"}</script>'), null)
  assertEquals(fallbackArticle('<p>no structured data</p>'), null)
})

Deno.test('bodyToHtml splits on single or double newlines', () => {
  assertEquals(bodyToHtml('a\r\nb\n\n c '), '<p>a</p>\n<p>b</p>\n<p>c</p>')
})
