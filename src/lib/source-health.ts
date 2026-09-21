export type SourceHealth = 'disabled' | 'unknown' | 'retrying' | 'failing' | 'stale' | 'recently fetched'

// Callers pass the shared reactive clock (clock.now), which ticks every 30s and
// so trails real time. A last_ok_at a few seconds past `now` is that lag — or
// ordinary drift between the runner's clock and the reader's — not a bad row, and
// reporting it as 'unknown' contradicts the "Last success just now" printed
// beside it. Only a timestamp implausibly far ahead is treated as unusable.
const CLOCK_SKEW_MS = 2 * 60_000

export function sourceHealth(source: {
  enabled: boolean; last_ok_at: string | null; consecutive_failures: number
}, now: number): SourceHealth {
  if (!source.enabled) return 'disabled'
  if (source.consecutive_failures > 6) return 'failing'
  if (source.consecutive_failures > 0) return 'retrying'
  if (!source.last_ok_at) return 'unknown'
  const age = now - Date.parse(source.last_ok_at)
  if (!Number.isFinite(age) || age < -CLOCK_SKEW_MS) return 'unknown'
  return age <= 60 * 60_000 ? 'recently fetched' : 'stale'
}
