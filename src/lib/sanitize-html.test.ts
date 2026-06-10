// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { cleanHtml } from './sanitize-html'

// Runs in jsdom — the DOM implementation DOMPurify is developed and tested
// against, so it mirrors real-browser behavior (the environment ArticlePanel
// renders in). This test locks the {@html} XSS fix.
describe('cleanHtml', () => {
  it('strips <script> tags', () => {
    const out = cleanHtml('<p>hi</p><script>alert(1)</script>')
    expect(out).toContain('hi')
    expect(out.toLowerCase()).not.toContain('<script')
  })

  it('strips inline event handlers', () => {
    const out = cleanHtml('<img src="x" onerror="alert(1)">')
    expect(out.toLowerCase()).not.toContain('onerror')
  })

  it('strips javascript: URLs', () => {
    const out = cleanHtml('<a href="javascript:alert(1)">click</a>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('strips <iframe>', () => {
    const out = cleanHtml('<iframe src="https://evil.example"></iframe>')
    expect(out.toLowerCase()).not.toContain('<iframe')
  })

  it('strips svg-based script vectors', () => {
    const out = cleanHtml('<svg><script>alert(1)</script></svg>')
    expect(out.toLowerCase()).not.toContain('alert(1)')
  })

  it('preserves safe formatting markup and links', () => {
    const out = cleanHtml('<p>Hello <strong>world</strong> <a href="https://example.com">link</a></p>')
    expect(out).toContain('<strong>world</strong>')
    expect(out).toContain('href="https://example.com"')
  })
})

// Reader articles arrive with the source page's relative URLs — without a base
// they'd resolve against OUR origin (SPA hijack, broken images).
describe('cleanHtml URL fixing', () => {
  const BASE = 'https://news.example.com/world/2026/story.html'

  it('absolutizes relative hrefs against the article URL', () => {
    const out = cleanHtml('<a href="/news/123">rel</a>', BASE)
    expect(out).toContain('href="https://news.example.com/news/123"')
  })

  it('absolutizes page-relative hrefs', () => {
    const out = cleanHtml('<a href="other.html">rel</a>', BASE)
    expect(out).toContain('href="https://news.example.com/world/2026/other.html"')
  })

  it('absolutizes relative image srcs and drops srcset', () => {
    const out = cleanHtml('<img src="/img/a.jpg" srcset="/img/a-2x.jpg 2x">', BASE)
    expect(out).toContain('src="https://news.example.com/img/a.jpg"')
    expect(out).not.toContain('srcset')
  })

  it('resolves protocol-relative URLs to the base scheme', () => {
    const out = cleanHtml('<img src="//cdn.example.com/a.jpg">', BASE)
    expect(out).toContain('src="https://cdn.example.com/a.jpg"')
  })

  it('preserves absolute URLs up to normalization', () => {
    const out = cleanHtml('<a href="https://other.example.org/p?q=1">x</a>', BASE)
    expect(out).toContain('href="https://other.example.org/p?q=1"')
  })

  it('forces target=_blank and rel=noopener on links', () => {
    const out = cleanHtml('<a href="/news/123">rel</a>', BASE)
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('leaves relative URLs unchanged when no base is given', () => {
    const out = cleanHtml('<a href="/news/123">rel</a>')
    expect(out).toContain('href="/news/123"')
  })

  it('still strips javascript: URLs with a base set', () => {
    const out = cleanHtml('<a href="javascript:alert(1)">x</a>', BASE)
    expect(out.toLowerCase()).not.toContain('javascript:')
  })
})
