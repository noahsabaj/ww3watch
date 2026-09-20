vi.mock('./ai-budget', () => ({ reserveClassification: async () => async () => {} }))
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const answer = (p: number) => new Response(JSON.stringify({ answers: { same_event: { noul: p } }, usage: { input_tokens: 570 } }))

describe('judgeSameEvent', () => {
  it('maps the probability to same / different / unsure, and sends only the two headlines', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { judgeSameEvent } = await import('./jev-pairs')
    const fetchMock = vi.fn((_u: string, init: RequestInit) => {
      const a = JSON.parse(String(init.body)).state.headline_a as string
      return Promise.resolve(answer(a === 'same' ? 0.95 : a === 'diff' ? 0.05 : 0.5))
    })
    vi.stubGlobal('fetch', fetchMock)

    expect((await judgeSameEvent('same', 'x')).verdict).toBe('same')
    expect((await judgeSameEvent('diff', 'x')).verdict).toBe('different')
    expect((await judgeSameEvent('hmm', 'x')).verdict).toBe('unsure')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).state).toEqual({ headline_a: 'same', headline_b: 'x' })
  })

  it('throws rather than inventing a verdict when the answer is missing', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { judgeSameEvent } = await import('./jev-pairs')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ answers: {} })))))
    await expect(judgeSameEvent('a', 'b')).rejects.toThrow()
  })

  it('judges a band that straddles the clustering threshold', async () => {
    vi.resetModules()
    const { PAIR_BAND } = await import('./jev-pairs')
    expect(PAIR_BAND.lo).toBeLessThan(0.83)
    expect(PAIR_BAND.hi).toBeGreaterThan(0.83)
  })
})
