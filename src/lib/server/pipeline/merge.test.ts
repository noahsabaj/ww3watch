import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  candidates: [] as unknown[],
  verdicts: {} as Record<string, 'same' | 'different' | 'unsure'>,
  merges: [] as Array<{ p_from: string; p_into: string }>,
  reelected: [] as string[][],
}))

vi.mock('../supabase', () => ({
  supabaseAdmin: {
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
    return Promise.resolve({ verdict, p: verdict === 'same' ? 0.95 : 0.05 })
  },
}))

import { mergeStories } from './clustering'
import type { RunStats } from './stats'

const pair = (a: string, b: string, aCount: number, bCount: number, sim: number) => ({
  r_a: a, r_b: b, r_a_title: a, r_b_title: b, r_a_count: aCount, r_b_count: bCount, r_sim: sim,
})

beforeEach(() => {
  state.candidates = []
  state.verdicts = {}
  state.merges = []
  state.reelected = []
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
})
