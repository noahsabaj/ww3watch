import { describe, it, expect, vi, beforeEach } from 'vitest'

// classify routes through callLLM (rate-limited + 429-retried), so mock that.
// LLMDeadlineError comes from the REAL module — classify distinguishes it by
// instanceof, so a stand-in class would make the test pass for the wrong reason.
vi.mock('./llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./llm')>()),
  callLLM: vi.fn(),
}))
import { callLLM } from './llm'
import { classifyArticles } from './classify'

const mockedCallLLM = vi.mocked(callLLM)
beforeEach(() => mockedCallLLM.mockReset())

describe('classifyArticles', () => {
  it('returns empty sets for no articles', async () => {
    const { relevant, rejected } = await classifyArticles([])
    expect(relevant.size).toBe(0)
    expect(rejected.size).toBe(0)
  })

  it('records LLM verdicts: relevant and rejected', async () => {
    mockedCallLLM.mockResolvedValue('[1,0]')
    const { relevant, rejected } = await classifyArticles([
      { guid: 'en1', title: 'Major airstrike reported in Gaza', summary: null, source_lang: 'en' },
      { guid: 'fa1', title: 'گزارش هواشناسی امروز تهران', summary: null, source_lang: 'fa' },
    ])
    expect(relevant.has('en1')).toBe(true)
    expect(rejected.has('fa1')).toBe(true) // weather story rejected — recorded
    expect(rejected.has('en1')).toBe(false)
  })

  it('treats non-0/1 elements (e.g. string "1") as batch failure, NOT verdicts', async () => {
    // Without strict validation this would permanently reject the whole batch.
    mockedCallLLM.mockResolvedValue('["1","0"]')
    const { relevant, rejected } = await classifyArticles([
      { guid: 'en1', title: 'Army shells city, dozens killed', summary: null, source_lang: 'en' },
      { guid: 'fa1', title: 'یک خبر محلی', summary: null, source_lang: 'fa' },
    ])
    // Fallback path: keyword filter keeps the en conflict story; non-English is
    // DEFERRED (no verdict either way — re-judged by the LLM next run)…
    expect(relevant.has('en1')).toBe(true)
    expect(relevant.has('fa1')).toBe(false)
    // …and crucially records NO permanent rejections.
    expect(rejected.size).toBe(0)
  })

  it('keyword fallback (malformed LLM response) defers non-English, records no rejections', async () => {
    // Malformed JSON → classifyBatch throws → fallback (same path as an LLM
    // network failure). Uses a resolved-but-bad value to avoid vitest-4
    // surfacing a mock rejection that downstream code already catches.
    mockedCallLLM.mockResolvedValue('not json')
    const { relevant, rejected } = await classifyArticles([
      { guid: 'en1', title: 'New coffee shop opens downtown', summary: null, source_lang: 'en' },
      { guid: 'fa1', title: 'یک خبر محلی', summary: null, source_lang: 'fa' },
    ])
    expect(relevant.has('en1')).toBe(false) // keyword-dropped this run…
    expect(rejected.has('en1')).toBe(false) // …but NOT permanently rejected
    expect(relevant.has('fa1')).toBe(false) // non-English deferred (no verdict)
    expect(rejected.has('fa1')).toBe(false)
  })

  it('reports batch failure counts (the LLM-down dead-man switch)', async () => {
    mockedCallLLM.mockResolvedValue('[1]') // single batch, succeeds
    const ok = await classifyArticles([
      { guid: 'a', title: 'Strike kills commander', summary: null, source_lang: 'en' },
    ])
    expect(ok.totalBatches).toBe(1)
    expect(ok.failedBatches).toBe(0)

    mockedCallLLM.mockResolvedValue('not json') // single batch, malformed → failed
    const down = await classifyArticles([
      { guid: 'b', title: 'Strike kills commander', summary: null, source_lang: 'en' },
    ])
    expect(down.totalBatches).toBe(1)
    expect(down.failedBatches).toBe(1) // failed === total ⇒ run() throws
  })

  const three = [
    { guid: 'a', title: 'Strike kills commander in border raid', summary: null, source_lang: 'en' },
    { guid: 'b', title: 'Ceasefire talks collapse overnight', summary: null, source_lang: 'en' },
    { guid: 'c', title: 'حملة جوية على ميناء', summary: null, source_lang: 'ar' },
  ]

  it('passes the deadline through to callLLM', async () => {
    mockedCallLLM.mockResolvedValue('[1,1,1]')
    const deadline = Date.now() + 60_000
    await classifyArticles(three, deadline)
    expect(mockedCallLLM.mock.calls[0][2]).toBe(deadline)
  })

  it('still classifies normally when no deadline is given', async () => {
    mockedCallLLM.mockResolvedValue('[1,0,1]')
    const r = await classifyArticles(three)
    expect(r.skippedBatches).toBe(0)
    expect(r.relevant.size).toBe(2)
    expect(r.rejected.size).toBe(1)
  })
})
