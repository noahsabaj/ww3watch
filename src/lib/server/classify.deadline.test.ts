import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyArticles } from './classify'
import { llmStats, resetLlmStats } from './llm'

// Deliberately does NOT mock ./llm — the point is the real integration:
// classifyArticles → the real callLLM → its deadline check. A mocked throw
// would prove only that classify handles an error object of the right shape,
// not that the two halves agree about when a run is out of budget.
//
// Nothing here touches the network: an expired deadline is refused before fetch
// is reached, which is itself the assertion. fetch is stubbed to fail loudly so
// a regression that DOES call out shows up as a failure rather than a hang.

const three = [
  { guid: 'a', title: 'Strike kills commander in border raid', summary: null, source_lang: 'en' },
  { guid: 'b', title: 'Ceasefire talks collapse overnight', summary: null, source_lang: 'en' },
  { guid: 'c', title: 'حملة جوية على ميناء', summary: null, source_lang: 'ar' },
]

afterEach(() => {
  vi.unstubAllGlobals()
  resetLlmStats()
})

describe('classifyArticles under an expired budget', () => {
  it('skips the batch without ever calling the provider', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network must not be touched')))
    vi.stubGlobal('fetch', fetchSpy)
    resetLlmStats()

    const r = await classifyArticles(three, Date.now() - 1)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(llmStats.deadlineSkips).toBeGreaterThan(0)
    expect(r.skippedBatches).toBe(1)
    // Must NOT count as a failure: running out of time is not the LLM being
    // down, and conflating them would fail the run on exactly the busy days
    // where classify is merely slow — and a failed run writes nothing, which is
    // the loop that left ~6000 articles permanently unclassified.
    expect(r.failedBatches).toBe(0)
    expect(r.totalBatches).toBe(1)
  })

  it('records no verdict, so every article stays new for the next run', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network must not be touched'))))

    const { relevant, rejected } = await classifyArticles(three, Date.now() - 1)

    // Notably the English ones do NOT fall through to the keyword filter: that
    // fallback exists for a BROKEN LLM, and applying it to a merely-slow run
    // would let time pressure quietly lower the relevance bar.
    expect(relevant.size).toBe(0)
    expect(rejected.size).toBe(0)
  })
})
