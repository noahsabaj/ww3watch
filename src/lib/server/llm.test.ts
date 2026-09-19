import { describe, it, expect, vi, afterEach } from 'vitest'
import { llmStats, resetLlmStats } from './llm'

// What the provider SAYS when it refuses. Run 474 recorded nine 429s and could
// not tell whether the binding limit was requests-per-minute or a token bucket;
// the answer had to be inferred from deadline-guard arithmetic because callLLM
// read the status code and discarded everything else. These assertions own the
// claim that the detail now survives into pipeline_runs.stats.

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  resetLlmStats()
})

const TPD_BODY = JSON.stringify({
  error: {
    message:
      'Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 300000, Used 299136, Requested 4210. Please try again in 8m32s.',
    type: 'tokens',
  },
})

function rateLimited(): Response {
  return new Response(TPD_BODY, {
    status: 429,
    headers: {
      'retry-after': '600',
      'x-ratelimit-limit-tokens': '300000',
      'x-ratelimit-remaining-tokens': '864',
      'x-ratelimit-reset-tokens': '8m32s',
    },
  })
}

describe('callLLM on a 429', () => {
  it('records which limit was hit, its headroom, and the provider’s own sentence', async () => {
    vi.resetModules()
    vi.stubEnv('LLM_MAX_RPM', '600') // 100ms interval; keeps the test fast
    const llm = await import('./llm')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(rateLimited())))

    // A 600s retry-after against a 5s budget: the call is refused after the
    // capture, so nothing sleeps.
    await expect(
      llm.callLLM([{ role: 'user', content: 'x' }], 16, Date.now() + 5_000),
    ).rejects.toBeInstanceOf(llm.LLMDeadlineError)

    const note = llm.llmStats.rateLimitNote
    expect(note).not.toBeNull()
    // The distinction the counters could not make: tokens, not requests.
    expect(note).toContain('x-ratelimit-limit-tokens=300000')
    expect(note).toContain('x-ratelimit-remaining-tokens=864')
    expect(note).toContain('tokens per day (TPD)')
    expect(note).toContain('retry-after=600')
    // Sizes the run budget: no wall-clock ceiling below this can ever be met by
    // waiting, which is the fact that makes LLM_MAX_RPM the wrong knob.
    expect(llm.llmStats.maxRetryAfterMs).toBe(600_000)
  })

  it('keeps the first 429 rather than overwriting it with later ones', async () => {
    vi.resetModules()
    vi.stubEnv('LLM_MAX_RPM', '600')
    const llm = await import('./llm')
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        call++
        return Promise.resolve(
          call === 1
            ? rateLimited()
            : new Response('{"error":{"message":"a later, less useful 429"}}', {
                status: 429,
                headers: { 'retry-after': '900' },
              }),
        )
      }),
    )

    await expect(
      llm.callLLM([{ role: 'user', content: 'x' }], 16, Date.now() + 5_000),
    ).rejects.toBeInstanceOf(llm.LLMDeadlineError)
    await expect(
      llm.callLLM([{ role: 'user', content: 'y' }], 16, Date.now() + 5_000),
    ).rejects.toBeInstanceOf(llm.LLMDeadlineError)

    expect(llm.llmStats.rateLimitNote).toContain('tokens per day (TPD)')
    expect(llm.llmStats.rateLimitNote).not.toContain('less useful')
    // ...but the WORST ask still wins, since that is what the budget must clear.
    expect(llm.llmStats.maxRetryAfterMs).toBe(900_000)
  })
})

describe('callLLM on a spent daily cap', () => {
  const ok = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 40, completion_tokens: 2 } }))

  it('fails fast instead of sleeping, and refuses later calls without a request', async () => {
    vi.resetModules()
    vi.stubEnv('LLM_MAX_RPM', '600')
    const llm = await import('./llm')
    const fetchMock = vi.fn(() => Promise.resolve(rateLimited()))
    vi.stubGlobal('fetch', fetchMock)

    // A 600s retry-after fits this deadline: without fail-fast this would sleep.
    const deadline = Date.now() + 3_600_000
    const t0 = Date.now()
    const opts = { failFastOnDailyCap: true }
    await expect(llm.callLLM([{ role: 'user', content: 'x' }], 16, deadline, opts)).rejects.toBeInstanceOf(llm.LLMDailyCapError)
    await expect(llm.callLLM([{ role: 'user', content: 'y' }], 16, deadline, opts)).rejects.toBeInstanceOf(llm.LLMDailyCapError)

    expect(Date.now() - t0).toBeLessThan(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(llm.llmStats.dailyCapSkips).toBe(2)
    expect(llm.llmStats.backoffMs).toBe(0)
  })

  it('is a deadline error to callers, so classify defers rather than falling back', async () => {
    vi.resetModules()
    const llm = await import('./llm')
    expect(new llm.LLMDailyCapError()).toBeInstanceOf(llm.LLMDeadlineError)
  })

  it('keeps a separate limiter and cap per profile', async () => {
    vi.resetModules()
    vi.stubEnv('LLM_MAX_RPM', '600')
    const llm = await import('./llm')
    const other = { baseUrl: 'https://other.example/v1', apiKey: 'k', model: 'm', maxRpm: 600, reasoningEffort: undefined }
    const fetchMock = vi.fn((url: string) => Promise.resolve(url.startsWith(other.baseUrl) ? rateLimited() : ok()))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      llm.callLLM([{ role: 'user', content: 'x' }], 16, undefined, { profile: other, failFastOnDailyCap: true }),
    ).rejects.toBeInstanceOf(llm.LLMDailyCapError)
    // The default profile is untouched by the other provider's cap.
    await expect(llm.callLLM([{ role: 'user', content: 'x' }], 16)).resolves.toBe('ok')
    expect(llm.llmStats.promptTokens).toBe(40)
    expect(llm.llmStats.completionTokens).toBe(2)
  })
})

describe('resetLlmStats', () => {
  it('resets the note to null rather than zero', () => {
    // The previous implementation zeroed every key via Object.keys, which would
    // leave rateLimitNote as the number 0 — truthy-adjacent garbage that reads
    // as "a 429 was recorded" in pipeline_runs.stats forever after.
    llmStats.rateLimitNote = 'stale note from a previous run'
    llmStats.maxRetryAfterMs = 149_000
    llmStats.calls = 7

    resetLlmStats()

    expect(llmStats.rateLimitNote).toBeNull()
    expect(llmStats.maxRetryAfterMs).toBe(0)
    expect(llmStats.calls).toBe(0)
  })
})
