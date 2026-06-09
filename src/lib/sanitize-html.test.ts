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
