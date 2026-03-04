import { describe, it, expect, vi } from 'vitest'
import { extractArticle } from './reader'

describe('extractArticle', () => {
  it('returns null on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'))
    const result = await extractArticle('https://example.com/article')
    expect(result).toBeNull()
  })

  it('returns null on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Not Found', { status: 404 })
    )
    const result = await extractArticle('https://example.com/article')
    expect(result).toBeNull()
  })

  it('returns null on timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted.', 'AbortError')
    )
    const result = await extractArticle('https://example.com/article')
    expect(result).toBeNull()
  })

  it('returns extracted article from valid HTML', async () => {
    const html = `<!DOCTYPE html><html><head><title>Test Article</title></head>
    <body><article><p>This is a test article with enough content to be extracted by Readability. It needs several sentences to pass the minimum word count threshold that Mozilla Readability requires before it considers content worth extracting.</p></article></body></html>`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })
    )
    const result = await extractArticle('https://example.com/article')
    expect(result).not.toBeNull()
    expect(result?.content).toContain('test article')
  })

  it('returns null when Readability finds no content', async () => {
    const html = `<html><body></body></html>`
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })
    )
    const result = await extractArticle('https://example.com/article')
    expect(result).toBeNull()
  })
})
