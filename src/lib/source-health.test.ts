import { describe, expect, it } from 'vitest'
import { sourceHealth } from './source-health'
describe('source fetch status is not editorial credibility', () => {
  const now = Date.parse('2026-09-20T12:00:00Z')
  const source = { enabled: true, last_ok_at: '2026-09-20T11:00:00Z', consecutive_failures: 0 }
  it('bounds recent health and excludes disabled feeds', () => {
    expect(sourceHealth(source, now)).toBe('recently fetched')
    expect(sourceHealth(source, now + 1)).toBe('stale')
    expect(sourceHealth({ ...source, enabled: false }, now)).toBe('disabled')
  })
  it('distinguishes failures and missing or invalid success timestamps', () => {
    expect(sourceHealth({ ...source, consecutive_failures: 6 }, now)).toBe('retrying')
    expect(sourceHealth({ ...source, consecutive_failures: 7 }, now)).toBe('failing')
    for (const last_ok_at of [null, 'not a date', '2026-09-21T12:00:00Z']) {
      expect(sourceHealth({ ...source, last_ok_at }, now)).toBe('unknown')
    }
  })
  it('reads a success inside the shared clock’s lag as fresh, not unknown', () => {
    // clock.now ticks every 30s, so a feed fetched seconds ago can carry a
    // last_ok_at slightly ahead of it. That used to render the contradiction
    // "Fetch status: unknown. Last success just now."
    expect(sourceHealth({ ...source, last_ok_at: '2026-09-20T12:00:20Z' }, now)).toBe('recently fetched')
    expect(sourceHealth({ ...source, last_ok_at: '2026-09-20T12:01:59Z' }, now)).toBe('recently fetched')
    expect(sourceHealth({ ...source, last_ok_at: '2026-09-20T12:02:01Z' }, now)).toBe('unknown')
  })
})
