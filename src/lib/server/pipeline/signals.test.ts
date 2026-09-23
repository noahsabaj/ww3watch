import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = { id: string; guid: string; title: string; summary: string | null; source_lang: string; jev_relevant: number | null }

const state = vi.hoisted(() => ({
  pending: [] as Row[],
  annotated: [] as Array<Record<string, unknown>>,
  asked: [] as Array<{ title: string; knownRelevant: number | null }>,
  applied: [] as Array<Record<string, unknown>>,
  purged: [] as string[],
  lookupFails: false,
}))

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: () => {
      let worklist = false
      const q = {
        select: () => q, gte: () => q, order: () => q, limit: () => q, not: () => q,
        is: () => { worklist = true; return q },
        in: (_col: string, titles: string[]) => { q.titles = titles; return q },
        titles: [] as string[],
        then: (resolve: (v: unknown) => void) =>
          resolve(!worklist && state.lookupFails
            ? { data: null, error: { message: 'TypeError: fetch failed' } }
            : { data: worklist ? state.pending : state.annotated.filter((d) => q.titles.includes(d.title as string)), error: null }),
      }
      return q
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name === 'apply_article_signals') {
        const items = params.p_items as Array<Record<string, unknown>>
        state.applied.push(...items)
        return Promise.resolve({ data: items.length, error: null })
      }
      if (name === 'purge_irrelevant_articles') {
        state.purged.push(...(params.p_ids as string[]))
        return Promise.resolve({ data: (params.p_ids as string[]).length, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  },
}))
vi.mock('./persist', () => ({ writeVerdicts: async () => 0 }))
vi.mock('../jev-signals', () => ({
  askSignals: async (a: Row, _deadline: number, knownRelevant: number | null) => {
    state.asked.push({ title: a.title, knownRelevant })
    return {
      topic: 'armed_conflict', severity: 0.5, claim: 0.1, unverified: 0.2, opinion: 0.05,
      actors: ['russia'], jev_relevant: knownRelevant ?? (a.title.startsWith('Irrelevant') ? 0.01 : 0.9), inputTokens: 2000,
    }
  },
}))

import { enrichSignals, titleChunks } from './signals'
import type { RunStats } from './stats'

let n = 0
const row = (title: string, o: Partial<Row> = {}): Row =>
  ({ id: `a${++n}`, guid: `g${n}`, title, summary: 'Same wire copy.', source_lang: 'en', jev_relevant: null, ...o })

beforeEach(() => {
  state.pending = []
  state.annotated = []
  state.asked = []
  state.applied = []
  state.purged = []
  state.lookupFails = false
})

describe('titleChunks', () => {
  it('keeps each lookup URL short: Persian headlines split long before 25 a request', () => {
    const fa = Array.from({ length: 25 }, (_, i) => `خبر مهم یک مقام ایرانی درباره مذاکرات ایران و آمریکا ${i}`)
    const chunks = titleChunks(fa)
    expect(chunks.flat()).toEqual(fa)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.map((t) => encodeURIComponent(t).length).reduce((a, b) => a + b)).toBeLessThanOrEqual(4000)
  })

  it('still caps short titles at 25 a request, and never drops an overlong one', () => {
    expect(titleChunks(Array.from({ length: 30 }, (_, i) => `t${i}`)).map((c) => c.length)).toEqual([25, 5])
    const long = 'x'.repeat(5000)
    expect(titleChunks([long, 'a'])).toEqual([[long], ['a']])
  })
})

describe('enrichSignals', () => {
  it('annotates everything by asking when the copy lookup fails, instead of failing the stage', async () => {
    state.lookupFails = true
    state.pending = [row('Strike on port'), row('Other story')]
    const stats: RunStats = {}
    await enrichSignals(stats, Date.now() + 60_000)
    expect(state.applied).toHaveLength(2)
    expect(stats.signals_error).toBeUndefined()
    expect(stats.signals_copy_error).toContain('fetch failed')
  })

  it('asks once for copies that share a headline, summary and language, and annotates them all', async () => {
    state.pending = [row('Strike on port'), row('Strike on port'), row('Strike on port', { source_lang: 'fr' }), row('Other story')]
    const stats: RunStats = {}
    await enrichSignals(stats, Date.now() + 60_000)
    expect(state.asked.map((a) => a.title).sort()).toEqual(['Other story', 'Strike on port', 'Strike on port'])
    expect(state.applied).toHaveLength(4)
    expect(stats.signals_reused).toBe(1)
    expect(stats.signals_tokens).toBe(6000)
  })

  it('a copy of an article annotated in an earlier run takes its answers without asking', async () => {
    const copy = row('Strike on port')
    state.pending = [copy]
    state.annotated = [{ title: 'Strike on port', summary: 'Same wire copy.', source_lang: 'en', topic: 'diplomacy', severity: 0.25, claim: 0.9, unverified: 0.1, opinion: 0, actors: ['iran'], jev_relevant: 0.8 }]
    const stats: RunStats = {}
    await enrichSignals(stats, Date.now() + 60_000)
    expect(state.asked).toEqual([])
    expect(state.applied).toEqual([{ id: copy.id, topic: 'diplomacy', severity: 0.25, claim: 0.9, unverified: 0.1, opinion: 0, actors: ['iran'], jev_relevant: 0.8 }])
    expect(stats.signals_reused).toBe(1)
  })

  it('never borrows from a different summary or language', async () => {
    state.pending = [row('Strike on port', { summary: 'Different text.' })]
    state.annotated = [{ title: 'Strike on port', summary: 'Same wire copy.', source_lang: 'en', topic: 'diplomacy', severity: 0, claim: 0, unverified: 0, opinion: 0, actors: [], jev_relevant: 0.8 }]
    await enrichSignals({}, Date.now() + 60_000)
    expect(state.asked).toHaveLength(1)
  })

  it('skips the relevance question when any copy already has Jev’s answer, and a copy keeps its own', async () => {
    const head = row('Strike on port')
    const jev = row('Strike on port', { jev_relevant: 0.66 })
    state.pending = [head, jev]
    await enrichSignals({}, Date.now() + 60_000)
    expect(state.asked).toEqual([{ title: 'Strike on port', knownRelevant: 0.66 }])
    expect(state.applied.map((a) => a.jev_relevant)).toEqual([0.66, 0.66])
  })

  it('purges every head-accepted copy Jev puts below the bar, as if each had been asked', async () => {
    const a = row('Irrelevant cup final')
    const b = row('Irrelevant cup final')
    state.pending = [a, b]
    await enrichSignals({}, Date.now() + 60_000)
    expect(state.asked).toHaveLength(1)
    expect(state.purged.sort()).toEqual([a.id, b.id].sort())
  })
})
