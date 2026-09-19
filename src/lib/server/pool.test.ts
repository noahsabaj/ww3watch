import { describe, it, expect } from 'vitest'
import { mapPool } from './pool'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('mapPool', () => {
  it('never runs more than `concurrency` at once, and finishes everything', async () => {
    let live = 0
    let peak = 0
    const { done } = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      peak = Math.max(peak, ++live)
      await sleep(5)
      live--
      return n * 2
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(done.map((d) => d.value).sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10, 12, 14])
  })

  it('records a throwing item as failed and keeps going', async () => {
    const r = await mapPool(['a', 'boom', 'c'], 2, async (s) => {
      if (s === 'boom') throw new Error('nope')
      return s.toUpperCase()
    })
    expect(r.done.map((d) => d.value).sort()).toEqual(['A', 'C'])
    expect(r.failed.map((f) => f.item)).toEqual(['boom'])
    expect(r.skipped).toEqual([])
  })

  it('stops starting work past the deadline, without calling fn', async () => {
    let calls = 0
    const r = await mapPool([1, 2, 3], 2, async () => { calls++ }, { deadlineMs: Date.now() - 1 })
    expect(calls).toBe(0)
    expect(r.skipped).toEqual([1, 2, 3])
  })

  it('handles an empty list', async () => {
    const r = await mapPool([], 8, async () => 1)
    expect(r).toEqual({ done: [], failed: [], skipped: [] })
  })
})
