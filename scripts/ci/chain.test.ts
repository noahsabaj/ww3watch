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
    expect(result).toEqual({ sleptSeconds: 660 })
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
