import { describe, it, expect } from 'vitest'
import { chainNextRun, nextRunDelaySeconds } from './chain'
import { fakeGh } from './fake-gh'

describe('nextRunDelaySeconds', () => {
  it('is cadence minus elapsed', () => {
    expect(nextRunDelaySeconds(1_000, 1_240, 900)).toBe(660)
    expect(nextRunDelaySeconds(1_000, 1_000, 900)).toBe(900)
    expect(nextRunDelaySeconds(1_000, 1_899, 900)).toBe(1)
  })

  it('floors at 0 when the run took exactly the cadence', () => {
    expect(nextRunDelaySeconds(1_000, 1_900, 900)).toBe(0)
  })

  it('is 0, never negative, when the run took longer than the cadence', () => {
    expect(nextRunDelaySeconds(1_000, 2_150, 900)).toBe(0)
  })

  it('rejects non-numbers instead of silently unpacing the chain', () => {
    expect(() => nextRunDelaySeconds(NaN, 1_000, 900)).toThrow(/startEpoch/)
    expect(() => nextRunDelaySeconds(1_000, 1_100, NaN)).toThrow(/cadence/)
  })
})

describe('chainNextRun', () => {
  const base = { startEpoch: 1_000, cadence: 900, workflow: 'pipeline.yml', ref: 'main' }

  it('sleeps the remainder, THEN dispatches the workflow on the same ref', async () => {
    const { gh, calls } = fakeGh()
    const order: string[] = []
    const result = await chainNextRun(
      async (args) => { order.push('dispatch'); return gh(args) },
      { ...base, now: () => 1_240, wait: async (s) => { order.push(`sleep ${s}`) } },
    )
    expect(result).toEqual({ sleptSeconds: 660, dispatched: true })
    expect(order).toEqual(['sleep 660', 'dispatch'])
    expect(calls).toEqual([['workflow', 'run', 'pipeline.yml', '--ref', 'main']])
  })

  it('dispatches immediately, without sleeping, after a slow run', async () => {
    const { gh, calls } = fakeGh()
    let slept = false
    await chainNextRun(gh, { ...base, now: () => 2_150, wait: async () => { slept = true } })
    expect(slept).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('throws when the dispatch fails', async () => {
    const { gh } = fakeGh([[['workflow', 'run'], { code: 1, stderr: 'HTTP 403' }]])
    await expect(chainNextRun(gh, { ...base, now: () => 2_150 })).rejects.toThrow(/gh workflow run exited 1: HTTP 403/)
  })
})

// A dispatch lands on a waiting run and cancels it, so chaining past a waiting
// curation run is what kept source-curation.yml from ever starting.
describe('chainNextRun yielding to a waiting curation run', () => {
  const base = { startEpoch: 1_000, cadence: 900, workflow: 'pipeline.yml', ref: 'main', yieldTo: 'source-curation.yml', now: () => 2_150 }
  const listing = (...statuses: string[]) => fakeGh([
    [['run', 'list'], { stdout: JSON.stringify(statuses.map(status => ({ status }))) }],
  ])

  it('skips the dispatch while a curation run is waiting on the group', async () => {
    const { gh, calls } = listing('completed', 'queued')
    expect(await chainNextRun(gh, base)).toEqual({ sleptSeconds: 0, dispatched: false })
    expect(calls).toEqual([['run', 'list', '--workflow', 'source-curation.yml', '--limit', '20', '--json', 'status']])
  })

  it('treats an in-progress curation run as waiting too: the group is still taken', async () => {
    const { gh, calls } = listing('in_progress')
    expect((await chainNextRun(gh, base)).dispatched).toBe(false)
    expect(calls.some(c => c[0] === 'workflow')).toBe(false)
  })

  it('chains normally when every curation run is finished', async () => {
    const { gh, calls } = listing('completed', 'completed')
    expect((await chainNextRun(gh, base)).dispatched).toBe(true)
    expect(calls).toContainEqual(['workflow', 'run', 'pipeline.yml', '--ref', 'main'])
  })

  it('chains when there has never been a curation run', async () => {
    const { gh } = listing()
    expect((await chainNextRun(gh, base)).dispatched).toBe(true)
  })

  // Ingestion outliving one curation run beats a flaky lookup stopping ingestion.
  it('chains anyway when the lookup fails or returns junk', async () => {
    const failed = fakeGh([[['run', 'list'], { code: 1, stderr: 'HTTP 502' }]])
    expect((await chainNextRun(failed.gh, base)).dispatched).toBe(true)
    const junk = fakeGh([[['run', 'list'], { stdout: 'not json' }]])
    expect((await chainNextRun(junk.gh, base)).dispatched).toBe(true)
  })

  it('does not look the run up at all when no yieldTo is configured', async () => {
    const { gh, calls } = listing('queued')
    expect((await chainNextRun(gh, { ...base, yieldTo: undefined })).dispatched).toBe(true)
    expect(calls.every(c => c[0] !== 'run')).toBe(true)
  })

  // The sleep is most of the cadence; a curation run dispatched during it is
  // precisely the one that must not be displaced.
  it('checks after the pacing sleep, not before', async () => {
    const order: string[] = []
    const { gh } = fakeGh([[['run', 'list'], (args) => { order.push(args[0]); return { stdout: '[]' } }]])
    await chainNextRun(gh, { ...base, now: () => 1_240, wait: async (s) => { order.push(`sleep ${s}`) } })
    expect(order).toEqual(['sleep 660', 'run'])
  })
})
