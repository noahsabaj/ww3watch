export type SourceHealth = 'disabled' | 'unknown' | 'retrying' | 'failing' | 'stale' | 'recently fetched'
export function sourceHealth(source: {
  enabled: boolean; last_ok_at: string | null; consecutive_failures: number
}, now: number): SourceHealth {
  if (!source.enabled) return 'disabled'
  if (source.consecutive_failures > 6) return 'failing'
  if (source.consecutive_failures > 0) return 'retrying'
  if (!source.last_ok_at) return 'unknown'
  const age = now - Date.parse(source.last_ok_at)
  if (!Number.isFinite(age) || age < 0) return 'unknown'
  return age <= 60 * 60_000 ? 'recently fetched' : 'stale'
}
