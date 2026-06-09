import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyArticles } from './classify'

// classify.ts reads LLM_* from env at import (provided as dummies via vite.config
// test.env) and calls global fetch, which we mock here.
function llmResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
}

afterEach(() => vi.restoreAllMocks())

describe('classifyArticles', () => {
  it('returns an empty set for no articles', async () => {
    const relevant = await classifyArticles([])
    expect(relevant.size).toBe(0)
  })

  it('classifies non-English through the LLM instead of auto-passing it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(llmResponse('[1,0]'))
    const relevant = await classifyArticles([
      { guid: 'en1', title: 'Major airstrike reported in Gaza', summary: null, source_lang: 'en' },
      { guid: 'fa1', title: 'گزارش هواشناسی امروز تهران', summary: null, source_lang: 'fa' },
    ])
    expect(relevant.has('en1')).toBe(true)
    // The LLM marked the Persian weather item 0 — previously it would have auto-passed.
    expect(relevant.has('fa1')).toBe(false)
  })

  it('falls back to the keyword filter on LLM failure (lenient for non-English)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('LLM down'))
    const relevant = await classifyArticles([
      { guid: 'en1', title: 'New coffee shop opens downtown', summary: null, source_lang: 'en' },
      { guid: 'fa1', title: 'یک خبر محلی', summary: null, source_lang: 'fa' },
    ])
    expect(relevant.has('en1')).toBe(false) // no conflict keyword → dropped
    expect(relevant.has('fa1')).toBe(true) // non-English kept leniently on fallback
  })
})
