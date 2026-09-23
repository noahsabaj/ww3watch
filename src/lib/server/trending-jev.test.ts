vi.mock('./ai-budget', () => ({ reserveClassification: async () => async () => {} }))
import { describe, it, expect, vi, afterEach } from 'vitest'
import { corroboration, trendingScore } from './trending-jev'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const cand = (independent: number, regions = 1, langs = 1) => ({ headline: 'h', otherHeadlines: [], independent, regions, langs })

describe('trendingScore', () => {
  it('ranks a corroborated major event above a lone statement about a grave subject', () => {
    const strike = trendingScore(cand(9, 4, 3), { severity: 0.67, fresh: 0.95, talk: 0.05 })
    const threat = trendingScore(cand(2, 1, 1), { severity: 0.2, fresh: 0.9, talk: 0.97 })
    expect(strike).toBeGreaterThan(threat)
  })

  it('lets severity beat raw source count: a nuclear test on 2 wires outranks a recap on 12', () => {
    const test = trendingScore(cand(2, 2, 2), { severity: 1, fresh: 0.95, talk: 0.05 })
    const recap = trendingScore(cand(12, 3, 2), { severity: 0.33, fresh: 0.1, talk: 0.1 })
    expect(test).toBeGreaterThan(recap)
  })

  it('counts breadth in code, saturating rather than growing without bound', () => {
    expect(corroboration(cand(1))).toBeLessThan(corroboration(cand(3)))
    expect(corroboration(cand(3, 1, 1))).toBeLessThan(corroboration(cand(3, 3, 2)))
    expect(corroboration(cand(500, 50, 50))).toBeCloseTo(1)
  })
})

describe('rankWithJev', () => {
  const answer = (score: number, fresh: number, talk: number) =>
    new Response(JSON.stringify({ answers: { severity: { score }, fresh: { noul: fresh }, talk: { noul: talk } }, usage: { input_tokens: 1 } }))

  it('returns the top picks best-first, and null when too few could be judged', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { rankWithJev } = await import('./trending-jev')
    const byHeadline: Record<string, () => Response> = {
      big: () => answer(3, 0.9, 0.1),
      mid: () => answer(2, 0.9, 0.1),
      small: () => answer(0, 0.2, 0.9),
      broken: () => new Response('x', { status: 500 }),
    }
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) =>
      Promise.resolve(byHeadline[JSON.parse(String(init.body)).state.story.headline as string]())))
    const c = (headline: string) => ({ ...cand(3, 2, 2), headline })

    const ok = await rankWithJev([c('small'), c('big'), c('broken'), c('mid')], 2)
    expect(ok?.indices).toEqual([1, 3])

    expect(await rankWithJev([c('broken'), c('broken'), c('big')], 2)).toBeNull()
  })
})

describe('rankWithJev with a judgment cache', () => {
  const answer = new Response(JSON.stringify({ answers: { severity: { score: 2 }, fresh: { noul: 0.9 }, talk: { noul: 0.1 } }, usage: { input_tokens: 1 } }))

  it('asks only about stories whose headlines changed, and keeps what it asked', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { rankWithJev, judgmentKey } = await import('./trending-jev')
    const story = (headline: string, others: string[] = []) => ({ headline, otherHeadlines: others, independent: 3, regions: 2, langs: 2 })
    const same = story('Strike on port', ['Port hit overnight'])
    const changed = story('Strike on port', ['Port hit overnight', 'New: toll rises'])
    const fresh = story('Ceasefire talks resume')
    const stored = new Map([[judgmentKey(same), { severity: 0.67, fresh: 0.8, talk: 0.1 }]])
    const put: string[] = []
    const cache = {
      get: async (keys: string[]) => new Map(keys.filter((k) => stored.has(k)).map((k) => [k, stored.get(k)!])),
      put: async (entries: Array<{ key: string }>) => { put.push(...entries.map((e) => e.key)) },
    }
    const fetch = vi.fn(async () => answer.clone())
    vi.stubGlobal('fetch', fetch)
    const counts = { asked: 0, reused: 0 }
    expect(await rankWithJev([same, changed, fresh], 2, undefined, cache, counts)).not.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(counts).toEqual({ asked: 2, reused: 1 })
    expect(put.sort()).toEqual([judgmentKey(changed), judgmentKey(fresh)].sort())
    expect(judgmentKey(changed)).not.toBe(judgmentKey(same))
  })

  it('asks everything when the cache cannot be read', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { rankWithJev } = await import('./trending-jev')
    const story = (headline: string) => ({ headline, otherHeadlines: [], independent: 3, regions: 2, langs: 2 })
    const fetch = vi.fn(async () => answer.clone())
    vi.stubGlobal('fetch', fetch)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cache = { get: async () => { throw new Error('down') }, put: async () => {} }
    expect(await rankWithJev([story('a'), story('b'), story('c')], 2, undefined, cache)).not.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
