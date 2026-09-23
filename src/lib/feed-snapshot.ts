// The phone's own copy of the feed, so reopening the app shows stories at once
// instead of waiting on the network (~0.8s from Supabase on a good connection,
// up to the service worker's 3s timeout on a poor one). Saved when the page is
// hidden; used only while it is recent, because an old copy would open on
// stale news. The fresh load still runs and anything new it brings waits
// behind the "new stories" pill (feed.svelte.ts adopt).
import { load, save } from './saved'
import type { FeedInitial } from './feed.svelte'

/** How old a saved copy may be and still open the feed. */
export const SNAPSHOT_MAX_AGE_MS = 30 * 60_000

export function saveSnapshot(value: FeedInitial, now = Date.now()): void {
  if (value.articles.length === 0) return
  save('feedSnapshot', JSON.stringify({ savedAt: now, ...value }))
}

export function loadSnapshot(now = Date.now()): FeedInitial | null {
  const raw = load('feedSnapshot')
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<FeedInitial> & { savedAt?: unknown }
    if (typeof v.savedAt !== 'number' || now - v.savedAt > SNAPSHOT_MAX_AGE_MS || now < v.savedAt) return null
    if (!Array.isArray(v.articles) || v.articles.length === 0 || !Array.isArray(v.trending)) return null
    return { articles: v.articles, trending: v.trending, lastUpdatedAt: typeof v.lastUpdatedAt === 'string' ? v.lastUpdatedAt : null }
  } catch {
    return null
  }
}
