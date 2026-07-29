import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyArticles } from './classify'
import { callLLM, LLMDeadlineError, llmStats, resetLlmStats } from './llm'

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

describe('the rate limiter past a deadline', () => {
  // Batches queue on the limiter BEFORE the deadline and can reach the front
  // after it. If each still paid the rate-limit interval on its way to being
  // refused, N waiting batches would burn N × interval of dead time entirely
  // past the budget — putting the run straight back on course for the job
  // timeout the deadline exists to avoid. The queue must drain, not idle.
  it('drains a queue of doomed calls instead of sleeping through the interval', async () => {
    // The deadline must expire WHILE calls are queued — an already-expired one
    // is refused before the gate is ever reached, which exercises a different
    // (and already covered) branch. Re-import with a 100ms interval so the
    // difference is measurable in milliseconds rather than minutes.
    vi.resetModules()
    vi.stubEnv('LLM_MAX_RPM', '600') // 60s/600 = 100ms between call starts
    const llm = await import('./llm')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))))

    const deadline = Date.now() + 50 // expires after the first call or two
    const startedAt = Date.now()
    await Promise.allSettled(
      Array.from({ length: 10 }, () => llm.callLLM([{ role: 'user', content: 'x' }], 16, deadline)),
    )
    const elapsed = Date.now() - startedAt

    // Draining: the queue empties as soon as the deadline passes (~100ms).
    // Idling: each of the ~8 doomed callers still sleeps its 100ms interval
    // first (~800ms), all of it spent past the budget.
    expect(elapsed).toBeLessThan(400)
  })
})
