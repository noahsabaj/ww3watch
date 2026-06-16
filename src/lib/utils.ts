// Full language names for tooltips / aria, and the translation UI (PR-D2 reuses
// this; the edge function keeps its own _shared copy).
export const LANG_NAMES: Record<string, string> = {
  en: 'English', fa: 'Persian', ar: 'Arabic', he: 'Hebrew', ru: 'Russian',
  zh: 'Chinese', tr: 'Turkish', fr: 'French', de: 'German', ur: 'Urdu',
  no: 'Norwegian', sv: 'Swedish', uk: 'Ukrainian', hi: 'Hindi', es: 'Spanish', pt: 'Portuguese',
}

// Curated, ordered set of reading-target languages offered in the reader's
// language picker (the server accepts any LANG_NAMES key; this is just the UI
// subset — source-only locales like 'no'/'sv' aren't offered as reading targets).
export const TARGET_LANGS = ['en', 'es', 'fr', 'de', 'ru', 'ar', 'fa', 'he', 'zh', 'tr', 'uk', 'hi', 'pt', 'ur']

export function isRtlLang(lang: string): boolean {
  return lang === 'ar' || lang === 'fa' || lang === 'he' || lang === 'ur'
}

// Short uppercase language code shown as a provenance tag next to a source name.
// Replaces the old nation-flag emoji, which misattributed language to a single
// state (Arabic→🇸🇦, Persian→🇮🇷, exile Russians→🇷🇺) and made screen readers
// announce e.g. "flag: Saudi Arabia" before a Qatari headline. English (the
// default majority) returns '' so the tag only marks non-English provenance.
export function langTag(lang: string): string {
  return !lang || lang === 'en' ? '' : lang.toUpperCase()
}

// Curated outlet-allegiance classes (sources.affiliation): labels + tooltips.
export const AFFILIATION_LABELS: Record<string, string> = {
  state: 'STATE', public: 'PUBLIC', exile: 'EXILE',
}
export const AFFILIATION_TITLES: Record<string, string> = {
  state: 'State-controlled or state-owned media',
  public: 'Public broadcaster — publicly funded with an editorial charter',
  exile: 'Exile / diaspora outlet operating outside the country it covers',
}

// Time-anchored helpers take an optional nowMs so components can pass the
// shared reactive clock ($lib/now.svelte.ts) — labels then re-render as time
// passes instead of freezing on quiet tabs. Defaulting to Date.now() keeps
// server/pipeline callers unchanged.

export function isBreaking(publishedAt: string | null, nowMs: number = Date.now()): boolean {
  if (!publishedAt) return false
  return nowMs - new Date(publishedAt).getTime() < 30 * 60 * 1000
}

// Local-calendar-day helpers for the feed's date separators. Future-dated
// timestamps (broken feed timezones) clamp to today so a stray date never
// renders above "Today" in the DESC-sorted feed.
export function dayKey(dateStr: string | null, nowMs: number = Date.now()): string {
  if (!dateStr) return 'unknown'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 'unknown'
  const c = d.getTime() > nowMs ? new Date(nowMs) : d
  return `${c.getFullYear()}-${c.getMonth()}-${c.getDate()}`
}

export function dayLabel(dateStr: string | null, nowMs: number = Date.now()): string {
  const key = dayKey(dateStr, nowMs)
  if (key === 'unknown') return 'Earlier'
  const now = new Date(nowMs)
  if (key === dayKey(now.toISOString(), nowMs)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === dayKey(yesterday.toISOString(), nowMs)) return 'Yesterday'
  const d = new Date(dateStr!)
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

// Relative offset of a story member from the first report (e.g. "+23m", "+2h").
export function offsetLabel(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 1) return '+0m'
  if (m < 60) return `+${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `+${h}h`
  return `+${Math.round(h / 24)}d`
}

export function timeAgo(dateStr: string | null, nowMs: number = Date.now()): string {
  if (!dateStr) return 'unknown time'
  const diff = nowMs - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
