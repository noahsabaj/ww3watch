const LANG_FLAGS: Record<string, string> = {
  fa: '🇮🇷', ar: '🇸🇦', he: '🇮🇱', ru: '🇷🇺',
  zh: '🇨🇳', tr: '🇹🇷', fr: '🇫🇷', de: '🇩🇪', ur: '🇵🇰',
}

export function langFlag(lang: string): string {
  return LANG_FLAGS[lang] ?? ''
}

export function isBreaking(publishedAt: string | null): boolean {
  if (!publishedAt) return false
  return Date.now() - new Date(publishedAt).getTime() < 30 * 60 * 1000
}

// Local-calendar-day helpers for the feed's date separators. Future-dated
// timestamps (broken feed timezones) clamp to today so a stray date never
// renders above "Today" in the DESC-sorted feed.
export function dayKey(dateStr: string | null): string {
  if (!dateStr) return 'unknown'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 'unknown'
  const now = new Date()
  const c = d.getTime() > now.getTime() ? now : d
  return `${c.getFullYear()}-${c.getMonth()}-${c.getDate()}`
}

export function dayLabel(dateStr: string | null): string {
  const key = dayKey(dateStr)
  if (key === 'unknown') return 'Earlier'
  const now = new Date()
  if (key === dayKey(now.toISOString())) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === dayKey(yesterday.toISOString())) return 'Yesterday'
  const d = new Date(dateStr!)
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'unknown time'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
