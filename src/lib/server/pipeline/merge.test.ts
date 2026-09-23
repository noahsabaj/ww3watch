import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  candidates: [] as unknown[],
  verdicts: {} as Record<string, 'same' | 'different' | 'unsure'>,
  merges: [] as Array<{ p_from: string; p_into: string }>,
  reelected: [] as string[][],
  p: {} as Record<string, number>,
  remembered: [] as Array<{ rep_a: string; rep_b: string; verdict: string }>,
  forgotBefore: null as string | null,
}))

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'story_merge_judged') throw new Error(`unexpected table ${table}`)
      return {
        delete: () => ({ lt: (_col: string, v: string) => { state.forgotBefore = v; return Promise.resolve({ error: null }) } }),
        upsert: (rows: typeof state.remembered) => { state.remembered.push(...rows); return Promise.resolve({ error: null }) },
      }
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name === 'story_merge_candidates') return Promise.resolve({ data: state.candidates, error: null })
      if (name === 'merge_stories') {
        state.merges.push(params as { p_from: string; p_into: string })
        return Promise.resolve({ data: 3, error: null })
      }
      if (name === 'reelect_story_reps') {
        state.reelected.push(params.p_story_ids as string[])
        return Promise.resolve({ data: 1, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
  },
}))
vi.mock('../jev-pairs', () => ({
  judgeSameEvent: (a: string, b: string) => {
    const verdict = state.verdicts[`${a}|${b}`] ?? 'unsure'
    if (a === 'boom') return Promise.reject(new Error('jev down'))
    return Promise.resolve({ verdict, p: state.p[`${a}|${b}`] ?? (verdict === 'same' ? 0.95 : 0.05) })
  },
}))

import { mergeStories } from './clustering'
import type { RunStats } from './stats'

const pair = (a: string, b: string, aCount: number, bCount: number, sim: number) => ({
  r_a: a, r_b: b, r_a_rep: `rep-${a}`, r_b_rep: `rep-${b}`,
  r_a_title: a, r_b_title: b, r_a_count: aCount, r_b_count: bCount, r_sim: sim,
})

beforeEach(() => {
  state.candidates = []
  state.verdicts = {}
  state.merges = []
  state.reelected = []
  state.p = {}
  state.remembered = []
  state.forgotBefore = null
})

describe('mergeStories', () => {
  it('folds the smaller story into the larger when Jev says same, and re-elects the rep', async () => {
    state.candidates = [pair('small', 'big', 2, 9, 0.91)]
    state.verdicts = { 'small|big': 'same' }
    const stats: RunStats = {}
    await mergeStories(stats)
    expect(state.merges).toEqual([{ p_from: 'small', p_into: 'big' }])
    expect(stats.stories_merged).toBe(1)
    expect(state.reelected[0].sort()).toEqual(['big', 'small'])
  })

  it('holds merges to a stricter bar than joins: a 0.75 "same" is not enough', async () => {
    state.candidates = [pair('a', 'b', 3, 3, 0.9)]
    state.verdicts = { 'a|b': 'same' }
    state.p = { 'a|b': 0.75 }
    await mergeStories({})
    expect(state.merges).toEqual([])
  })

  it('does nothing for different or unsure pairs', async () => {
    state.candidates = [pair('a', 'b', 3, 3, 0.85), pair('c', 'd', 3, 3, 0.84)]
    state.verdicts = { 'a|b': 'different' }
    const stats: RunStats = {}
    await mergeStories(stats)
    expect(state.merges).toEqual([])
    expect(stats.stories_merged).toBeUndefined()
    expect(stats.merge_pairs_judged).toBe(2)
  })

  it('never chains merges in one run: a story already merged is left for the next', async () => {
    // a≈b and b≈c: after a→b, c must wait — b's rep and counts just changed.
    state.candidates = [pair('a', 'b', 1, 5, 0.95), pair('b', 'c', 5, 7, 0.9)]
    state.verdicts = { 'a|b': 'same', 'b|c': 'same' }
    await mergeStories({})
    expect(state.merges).toEqual([{ p_from: 'a', p_into: 'b' }])
  })

  it('a failed judgment is not a verdict, and never fails the run', async () => {
    state.candidates = [pair('boom', 'x', 1, 1, 0.99), pair('p', 'q', 1, 4, 0.9)]
    state.verdicts = { 'p|q': 'same' }
    const stats: RunStats = {}
    await expect(mergeStories(stats)).resolves.toBeUndefined()
    expect(state.merges).toEqual([{ p_from: 'p', p_into: 'q' }])
    expect(stats.merge_error).toBeUndefined()
  })

  it('remembers different and unsure pairs by their representatives, never a same', async () => {
    state.candidates = [pair('d', 'c', 1, 1, 0.95), pair('u', 'v', 1, 1, 0.9), pair('s', 't', 1, 2, 0.88), pair('w', 'x', 1, 1, 0.85)]
    state.verdicts = { 'd|c': 'different', 's|t': 'same', 'w|x': 'same' }
    state.p = { 'w|x': 0.75 }
    await mergeStories({})
    expect(state.remembered).toEqual([
      { rep_a: 'rep-c', rep_b: 'rep-d', verdict: 'different' },
      { rep_a: 'rep-u', rep_b: 'rep-v', verdict: 'unsure' },
      // Below the merge bar: asked about once, like unsure.
      { rep_a: 'rep-w', rep_b: 'rep-x', verdict: 'unsure' },
    ])
    expect(state.merges).toEqual([{ p_from: 's', p_into: 't' }])
  })

  it('forgets pairs older than twice the merge window', async () => {
    const before = Date.now()
    await mergeStories({})
    const cutoff = Date.parse(state.forgotBefore!)
    expect(before - cutoff).toBeGreaterThanOrEqual(48 * 3600_000 - 1000)
    expect(before - cutoff).toBeLessThanOrEqual(48 * 3600_000 + 1000)
  })
})

describe('tallyBySim', () => {
  it('counts each verdict under its 0.02 similarity step', async () => {
    const { tallyBySim } = await import('./stats')
    const stats: RunStats = {}
    tallyBySim(stats, 'pairs_by_sim', 0.781, 'different')
    tallyBySim(stats, 'pairs_by_sim', 0.799, 'different')
    tallyBySim(stats, 'pairs_by_sim', 0.8, 'same')
    tallyBySim(stats, 'pairs_by_sim', 0.86, 'unsure')
    expect(stats.pairs_by_sim).toEqual({
      '0.78': { same: 0, different: 2, unsure: 0 },
      '0.80': { same: 1, different: 0, unsure: 0 },
      '0.86': { same: 0, different: 0, unsure: 1 },
    })
  })

  it('records the merge pass by similarity, a sub-bar "same" as unsure', async () => {
    state.candidates = [pair('a', 'b', 1, 2, 0.91), pair('c', 'd', 1, 1, 0.87)]
    state.verdicts = { 'a|b': 'same', 'c|d': 'same' }
    state.p = { 'c|d': 0.75 }
    const stats: RunStats = {}
    await mergeStories(stats)
    expect(stats.merge_by_sim).toEqual({
      '0.90': { same: 1, different: 0, unsure: 0 },
      '0.86': { same: 0, different: 0, unsure: 1 },
    })
  })
})
