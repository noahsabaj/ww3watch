import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  // One entry consumed per rpc() call, so a test can make the first attempt
  // fail and the retry succeed.
  responses: [] as Array<{ data: unknown; error: unknown }>,
  calls: [] as unknown[],
}))

vi.mock('./supabase', () => ({
  supabaseAdmin: {
    rpc: (_fn: string, args: unknown) => {
      state.calls.push(args)
      return Promise.resolve(state.responses.shift() ?? { data: [], error: null })
    },
  },
}))

import { existingGuids } from './dedupe'

beforeEach(() => {
  state.responses = []
  state.calls = []
})

describe('existingGuids', () => {
  it('returns the guids the DB already knows', async () => {
    state.responses = [{ data: [{ guid: 'a' }, { guid: 'c' }], error: null }]
    const seen = await existingGuids(['a', 'b', 'c'])
    expect([...seen].sort()).toEqual(['a', 'c'])
  })

  // The defect: a swallowed RPC error meant an empty set, which reads as
  // "everything is new" — the run then re-classifies articles that already
  // carry permanent verdicts, burns the per-run classify cap on them, and
  // records a clean success. It must be loud instead.
  it('THROWS when the RPC fails, rather than reporting nothing as seen', async () => {
    state.responses = [
      { data: null, error: { message: 'boom' } },
      { data: null, error: { message: 'boom again' } },
    ]
    await expect(existingGuids(['a', 'b'])).rejects.toThrow(/existing_guids RPC failed/)
  })

  it('names the cost in the error so the log says why the run died', async () => {
    state.responses = [
      { data: null, error: { message: 'boom' } },
      { data: null, error: { message: 'boom again' } },
    ]
    await expect(existingGuids(['a', 'b'])).rejects.toThrow(/already-judged articles as new/)
  })

  it('absorbs a transient failure via one retry instead of failing the run', async () => {
    state.responses = [
      { data: null, error: { message: 'transient' } },
      { data: [{ guid: 'a' }], error: null },
    ]
    const seen = await existingGuids(['a', 'b'])
    expect([...seen]).toEqual(['a'])
    expect(state.calls).toHaveLength(2) // first attempt + retry
  })

  it('chunks large inputs and unions every chunk', async () => {
    const guids = Array.from({ length: 2500 }, (_, i) => `g${i}`)
    state.responses = [
      { data: [{ guid: 'g1' }], error: null },
      { data: [{ guid: 'g1500' }], error: null },
      { data: [{ guid: 'g2400' }], error: null },
    ]
    const seen = await existingGuids(guids)
    expect(state.calls).toHaveLength(3) // 1000 + 1000 + 500
    expect([...seen].sort()).toEqual(['g1', 'g1500', 'g2400'])
  })
})
