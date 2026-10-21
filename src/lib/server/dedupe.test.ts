import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  // One entry consumed per rpc() call, so a test can make the first attempt
  // fail and the retry succeed.
  responses: [] as Array<{ data: unknown; error: unknown }>,
  calls: [] as Array<{ fn: string; args: unknown }>,
}))

vi.mock('./supabase', () => ({
  supabaseAdmin: {
    rpc: (fn: string, args: unknown) => {
      state.calls.push({ fn, args })
      return Promise.resolve(state.responses.shift() ?? { data: [], error: null })
    },
  },
}))

// Fresh module per test: whether unseen_guids exists is remembered per process.
let existingGuids: typeof import('./dedupe').existingGuids
beforeEach(async () => {
  state.responses = []
  state.calls = []
  vi.resetModules()
  ;({ existingGuids } = await import('./dedupe'))
})

const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.unseen_guids' } }

describe('existingGuids', () => {
  it('works out the known guids from the ones the DB has never seen', async () => {
    state.responses = [{ data: [{ guid: 'b' }], error: null }]
    const seen = await existingGuids(['a', 'b', 'c'])
    expect([...seen].sort()).toEqual(['a', 'c'])
    expect(state.calls.map((c) => c.fn)).toEqual(['unseen_guids'])
  })

  it('asks existing_guids where unseen_guids is not applied yet, and keeps asking it', async () => {
    state.responses = [missing, { data: [{ guid: 'a' }, { guid: 'c' }], error: null }, { data: [{ guid: 'd' }], error: null }]
    expect([...(await existingGuids(['a', 'b', 'c']))].sort()).toEqual(['a', 'c'])
    expect([...(await existingGuids(['d', 'e']))]).toEqual(['d'])
    expect(state.calls.map((c) => c.fn)).toEqual(['unseen_guids', 'existing_guids', 'existing_guids'])
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
    await expect(existingGuids(['a', 'b'])).rejects.toThrow(/guid lookup RPC failed/)
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
      { data: [{ guid: 'b' }], error: null },
    ]
    const seen = await existingGuids(['a', 'b'])
    expect([...seen]).toEqual(['a'])
    expect(state.calls).toHaveLength(2) // first attempt + retry
  })

  it('chunks large inputs and unions every chunk', async () => {
    const guids = Array.from({ length: 2500 }, (_, i) => `g${i}`)
    const unseenExcept = (from: number, to: number, known: string) =>
      ({ data: guids.slice(from, to).filter((g) => g !== known).map((guid) => ({ guid })), error: null })
    state.responses = [unseenExcept(0, 1000, 'g1'), unseenExcept(1000, 2000, 'g1500'), unseenExcept(2000, 2500, 'g2400')]
    const seen = await existingGuids(guids)
    expect(state.calls).toHaveLength(3) // 1000 + 1000 + 500
    expect([...seen].sort()).toEqual(['g1', 'g1500', 'g2400'])
  })
})
