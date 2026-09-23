// Everything WW3Watch keeps in this browser, in one list: the privacy page
// promises exactly these and nothing else. Storage can be missing or refuse
// (server render, private mode, site data blocked), so every read and write
// goes through here and fails quietly; a feature falls back to its default
// for this visit instead of taking the page down with it.
export const SAVED = {
  /** The language the reader translates into (prefs.svelte.ts). */
  readingLang: 'reading-lang',
  /** When the reader last opened the feed, for "New since your last visit". */
  lastVisit: 'ww3-last-visit',
  /** The phone's "Add to home screen" banner was dismissed. */
  installDismissed: 'pwa-install-dismissed',
  /** Teaching tips already learned (tips.svelte.ts). Keys kept as first shipped. */
  tipSwipe: 'ww3-swiped',
  tipReadStory: 'ww3-read-tip-seen',
  /** A copy of the latest stories, so the app opens without waiting (feed-snapshot.ts). */
  feedSnapshot: 'ww3-feed-snapshot',
} as const
export type SavedKey = keyof typeof SAVED

export function load(key: SavedKey): string | null {
  try { return localStorage.getItem(SAVED[key]) } catch { return null }
}

export function save(key: SavedKey, value: string): void {
  try { localStorage.setItem(SAVED[key], value) } catch { /* kept for this visit only */ }
}
