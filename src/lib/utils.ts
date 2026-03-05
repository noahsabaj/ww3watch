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
