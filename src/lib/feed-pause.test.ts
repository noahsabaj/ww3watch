import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Supabase meters Realtime messages as egress: a tab hidden five minutes stops
// taking them, and one read catches it up when it is shown again.
const rt = vi.hoisted(() => ({
  subscribed: [] as string[],
  removed: [] as string[],
  reads: [] as Array<{ table: string; gte?: [string, string] }>,
  rows: [] as Array<Record<string, unknown>>,
}))

vi.mock('./supabase', () => {
  const channel = (name: string) => {
    const ch = {
      name,
      on: () => ch,
      subscribe: (cb?: (status: string) => void) => {
        rt.subscribed.push(name)
        cb?.('SUBSCRIBED')
        return ch
      },
    }
    return ch
  }
  const from = (table: string) => {
    const read: { table: string; gte?: [string, string] } = { table }
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      select: () => q, order: () => q, limit: () => q, range: () => q, eq: () => q,
      gte: (col: string, value: string) => ((read.gte = [col, value]), q),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        rt.reads.push(read)
        return Promise.resolve({ data: table === 'articles' ? rt.rows : [], error: null }).then(resolve, reject)
      },
    })
    return q
  }
  return {
    supabase: {
      channel,
      from,
      removeChannel: (ch: { name: string }) => (rt.removed.push(ch.name), Promise.resolve('ok')),
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  }
})
vi.mock('./load-feed', () => ({ loadFeed: vi.fn() }))

let visibility: 'visible' | 'hidden' = 'visible'
const doc = new EventTarget()
Object.defineProperty(doc, 'visibilityState', { get: () => visibility })
globalThis.document = doc as unknown as Document
const show = (v: 'visible' | 'hidden') => {
  visibility = v
  doc.dispatchEvent(new Event('visibilitychange'))
}

const article = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, story_id: null, source_name: 'Outlet', source_lang: 'en',
  published_at: new Date().toISOString(), fetched_at: new Date().toISOString(), ...extra,
})
const BOTH = ['articles-feed', 'articles-updates']

const { createFeed } = await import('./feed.svelte')
const make = () => createFeed({ articles: [article('held')] as never, trending: [], lastUpdatedAt: null }, { isPaused: () => false })

beforeEach(() => {
  vi.useFakeTimers()
  rt.subscribed = []
  rt.removed = []
  rt.reads = []
  rt.rows = []
  visibility = 'visible'
})
afterEach(() => vi.useRealTimers())

describe('a hidden tab', () => {
  it('stops taking live updates after five minutes, and catches up when shown again', async () => {
    const feed = make()
    feed.start()
    expect(rt.subscribed).toEqual(BOTH)
    show('hidden')
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(rt.removed).toEqual([])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(rt.removed).toEqual(BOTH)
    expect(feed.realtimeStatus).toBe('CLOSED')
    const pausedAt = Date.now()

    // An hour away: a new report came in, and the held one joined a story.
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    rt.rows = [article('new'), article('held', { story_id: 's1' })]
    show('visible')
    expect(rt.subscribed).toEqual([...BOTH, ...BOTH])
    await vi.advanceTimersByTimeAsync(0)
    const caughtUp = rt.reads.filter((r) => r.table === 'articles')
    expect(caughtUp).toHaveLength(1)
    expect(caughtUp[0].gte).toEqual(['fetched_at', new Date(pausedAt - 15 * 60_000).toISOString()])
    expect(feed.articles.map((a) => a.id)).toEqual(['new', 'held'])
    expect(feed.articles[1].story_id).toBe('s1')
    expect(feed.realtimeStatus).toBe('SUBSCRIBED')
    feed.stop()
  })

  it('keeps taking them through a short absence, and reads nothing extra', async () => {
    const feed = make()
    feed.start()
    show('hidden')
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    show('visible')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(rt.removed).toEqual([])
    expect(rt.subscribed).toEqual(BOTH)
    expect(rt.reads.filter((r) => r.table === 'articles')).toEqual([])
    feed.stop()
  })

  it('catches up after a phone suspended it, though no timer ran meanwhile', async () => {
    const feed = make()
    feed.start()
    show('hidden')
    const hiddenAt = Date.now()
    // Suspended: two hours pass and nothing runs; the socket is still "subscribed".
    vi.setSystemTime(hiddenAt + 2 * 3600_000)
    rt.rows = [article('new')]
    show('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.removed).toEqual([])
    expect(rt.subscribed).toEqual(BOTH)
    const caughtUp = rt.reads.filter((r) => r.table === 'articles')
    expect(caughtUp.map((r) => r.gte)).toEqual([['fetched_at', new Date(hiddenAt - 15 * 60_000).toISOString()]])
    expect(feed.articles.map((a) => a.id)).toEqual(['new', 'held'])
    feed.stop()
  })

  it('pauses when opened in the background, without a visibility change to say so', async () => {
    visibility = 'hidden'
    const feed = make()
    feed.start()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(rt.removed).toEqual(BOTH)
    feed.stop()
  })

  it('is left alone once the page is gone', async () => {
    const feed = make()
    feed.start()
    show('hidden')
    feed.stop()
    expect(rt.removed).toEqual(BOTH)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    show('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(rt.removed).toEqual(BOTH)
    expect(rt.subscribed).toEqual(BOTH)
  })
})
