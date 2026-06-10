import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dayKey, dayLabel, timeAgo, isBreaking } from './utils'

// The explicit nowMs param lets components anchor labels to the shared
// reactive clock ($lib/now.svelte.ts) so they re-render as time passes.
describe('explicit nowMs anchoring', () => {
  const NOW = new Date('2026-06-10T15:00:00').getTime()

  it('timeAgo anchors to the given now', () => {
    expect(timeAgo('2026-06-10T14:52:00', NOW)).toBe('8m ago')
    expect(timeAgo('2026-06-10T12:00:00', NOW)).toBe('3h ago')
    expect(timeAgo(null, NOW)).toBe('unknown time')
  })

  it('timeAgo labels advance as now advances (the ticking-clock case)', () => {
    const published = '2026-06-10T14:59:30'
    expect(timeAgo(published, NOW)).toBe('just now')
    expect(timeAgo(published, NOW + 5 * 60_000)).toBe('5m ago')
  })

  it('isBreaking ages out as now advances', () => {
    const published = '2026-06-10T14:45:00'
    expect(isBreaking(published, NOW)).toBe(true) // 15m old
    expect(isBreaking(published, NOW + 20 * 60_000)).toBe(false) // 35m old
  })

  it('dayLabel rolls over at midnight on an open tab', () => {
    const published = '2026-06-10T18:00:00'
    expect(dayLabel(published, new Date('2026-06-10T23:00:00').getTime())).toBe('Today')
    expect(dayLabel(published, new Date('2026-06-11T01:00:00').getTime())).toBe('Yesterday')
  })
})

// Timestamps WITHOUT a Z suffix parse as local time, keeping these assertions
// deterministic in any timezone (system time below is also local).
describe('dayKey / dayLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T15:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('labels today', () => {
    expect(dayLabel('2026-06-10T08:00:00')).toBe('Today')
  })

  it('labels yesterday', () => {
    expect(dayLabel('2026-06-09T23:00:00')).toBe('Yesterday')
  })

  it('labels older same-year dates without the year', () => {
    expect(dayLabel('2026-06-01T12:00:00')).toBe('June 1')
  })

  it('labels prior-year dates with the year', () => {
    expect(dayLabel('2025-12-31T12:00:00')).toBe('December 31, 2025')
  })

  it('groups all hours of one local day under one key', () => {
    expect(dayKey('2026-06-10T01:00:00')).toBe(dayKey('2026-06-10T23:00:00'))
    expect(dayKey('2026-06-10T01:00:00')).not.toBe(dayKey('2026-06-09T23:00:00'))
  })

  it('clamps future-dated timestamps to today', () => {
    expect(dayLabel('2026-06-11T09:00:00')).toBe('Today')
    expect(dayKey('2026-06-11T09:00:00')).toBe(dayKey('2026-06-10T08:00:00'))
  })

  it('maps null to unknown/Earlier', () => {
    expect(dayKey(null)).toBe('unknown')
    expect(dayLabel(null)).toBe('Earlier')
  })

  it('maps unparseable dates to unknown/Earlier', () => {
    expect(dayKey('not a date')).toBe('unknown')
    expect(dayLabel('not a date')).toBe('Earlier')
  })
})
