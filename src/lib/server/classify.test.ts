import { describe, it, expect, vi, beforeEach } from 'vitest'

// classify now routes through callLLM (rate-limited + 429-retried), so mock that.
vi.mock('./llm', () => ({ callLLM: vi.fn() }))
import { callLLM } from './llm'
import { classifyArticles } from './classify'

const mockedCallLLM = vi.mocked(callLLM)
beforeEach(() => mockedCallLLM.mockReset())

describe('classifyArticles', () => {
  it('returns an empty set for no articles', async () => {
    const relevant = await classifyArticles([])
    expect(relevant.size).toBe(0)
  })

  it('classifies non-English through the LLM instead of auto-passing it', async () => {
    mockedCallLLM.mockResolvedValue('[1,0]')
    const relevant = await classifyArticles([
      { guid: 'en1', title: 'Major airstrike reported in Gaza', summary: null, source_lang: 'en' },
      { guid: 'fa1', title: 'گزارش هواشناسی امروز تهران', summary: null, source_lang: 'fa' },
    ])
    expect(relevant.has('en1')).toBe(true)
    // The LLM marked the Persian weather item 0 — previously it would have auto-passed.
    expect(relevant.has('fa1')).toBe(false)
  })

  it('falls back to the keyword filter on a bad LLM response (lenient for non-English)', async () => {
    // Malformed response → classifyBatch's JSON.parse throws → keyword fallback.
    mockedCallLLM.mockResolvedValue('not json')
    const relevant = await classifyArticles([
      { guid: 'en1', title: 'New coffee shop opens downtown', summary: null, source_lang: 'en' },
      { guid: 'fa1', title: 'یک خبر محلی', summary: null, source_lang: 'fa' },
    ])
    expect(relevant.has('en1')).toBe(false) // no conflict keyword → dropped
    expect(relevant.has('fa1')).toBe(true) // non-English kept leniently on fallback
  })
})
