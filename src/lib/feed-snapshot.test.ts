import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadSnapshot, saveSnapshot, SNAPSHOT_MAX_AGE_MS } from './feed-snapshot'
import type { Article } from './types'

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  })
})
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
  else delete (globalThis as { localStorage?: Storage }).localStorage
})

const feed = { articles: [{ id: 'a1', title: 'Port strike' } as Article], trending: [], lastUpdatedAt: '2026-09-23T18:00:00Z' }
const t0 = Date.UTC(2026, 8, 23, 18)

describe('feed snapshot', () => {
  it('opens the feed from a recent copy', () => {
    saveSnapshot(feed, t0)
    expect(loadSnapshot(t0 + 10 * 60_000)).toEqual(feed)
  })

  it('ignores a copy older than half an hour, so the app never opens on stale news', () => {
    saveSnapshot(feed, t0)
    expect(loadSnapshot(t0 + SNAPSHOT_MAX_AGE_MS + 1)).toBeNull()
  })

  it('never saves an empty feed, and ignores a copy it cannot read', () => {
    saveSnapshot({ ...feed, articles: [] }, t0)
    expect(loadSnapshot(t0)).toBeNull()
    store.set('ww3-feed-snapshot', '{not json')
    expect(loadSnapshot(t0)).toBeNull()
    store.set('ww3-feed-snapshot', JSON.stringify({ savedAt: t0, articles: 'x', trending: [] }))
    expect(loadSnapshot(t0)).toBeNull()
  })

  it('distrusts a copy dated in the future (a clock set back)', () => {
    saveSnapshot(feed, t0)
    expect(loadSnapshot(t0 - 60_000)).toBeNull()
  })
})
