import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dayKey, dayLabel } from './utils'

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
