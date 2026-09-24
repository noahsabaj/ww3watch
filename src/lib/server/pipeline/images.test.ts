import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; url: string }>,
  updates: [] as Array<{ id: string; payload: Record<string, unknown> }>,
  stamps: [] as Array<{ ids: string[]; payload: Record<string, unknown> }>,
  retryFilter: '',
  html: {} as Record<string, string>,
  selectError: null as string | null,
}))

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        is: () => ({
          or: (expr: string) => {
            state.retryFilter = expr
            return {
              gte: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: state.selectError ? null : state.rows,
                      error: state.selectError ? { message: state.selectError } : null,
                    }),
                }),
              }),
            }
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: (col: string, id: string) => {
          if (col === 'id') state.updates.push({ id, payload })
          return Promise.resolve({ error: null })
        },
        in: (col: string, ids: string[]) => {
          if (col === 'id') state.stamps.push({ ids, payload })
          return Promise.resolve({ error: null })
        },
      }),
    }),
  },
}))

import { fillMissingImages, isFetchableArticleUrl } from './images'
import { UNREADABLE_RETRY_MINUTES } from '../config'
import type { RunStats } from './stats'

beforeEach(() => {
  state.rows = []
  state.updates = []
  state.stamps = []
  state.retryFilter = ''
  state.html = {}
  state.selectError = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (href: string) => {
      const url = new URL(href, 'https://proxy.example')
      const target = url.searchParams.get('url') ?? href
      const html = state.html[target]
      if (!html) return new Response('nope', { status: 404 })
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    }),
  )
})

describe('fillMissingImages', () => {
  it('stamps og:image onto articles that had none, and stamps a miss as looked-at', async () => {
    state.rows = [
      { id: 'has', url: 'https://news.example/a' },
      { id: 'none', url: 'https://news.example/b' },
    ]
    state.html['https://news.example/a'] =
      '<meta property="og:image" content="https://cdn.example/a.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="800">'
    state.html['https://news.example/b'] = '<html><head><title>No photo here</title></head></html>'
    const stats: RunStats = {}
    await fillMissingImages(stats, Date.now() + 10_000)
    expect(stats.images_filled).toBe(1)
    expect(stats.images_none).toBe(1)
    const has = state.updates.find((u) => u.id === 'has')!
    const none = state.updates.find((u) => u.id === 'none')!
    expect(has.payload.image_url).toBe('https://cdn.example/a.jpg')
    expect(has.payload.image_width).toBe(1200)
    expect(none.payload.image_url).toBeNull()
    expect(typeof none.payload.image_fetched_at).toBe('string')
  })

  it('leaves a page that did not answer unstamped, and has it wait an hour before the next try', async () => {
    state.rows = [{ id: 'blocked', url: 'https://news.example/403' }]
    const stats: RunStats = {}
    await fillMissingImages(stats, Date.now() + 10_000)
    expect(state.updates).toEqual([])
    expect(state.stamps).toEqual([{ ids: ['blocked'], payload: { image_fetch_failed_at: expect.any(String) } }])
    expect(stats.images_unreadable).toBe(1)
    expect(stats.images_none ?? 0).toBe(0)
  })

  it('asks only for pages never unreadable, or last unreadable an hour ago or more', async () => {
    await fillMissingImages({}, Date.now() + 10_000)
    const m = /^image_fetch_failed_at\.is\.null,image_fetch_failed_at\.lt\."(.+)"$/.exec(state.retryFilter)
    expect(m).not.toBeNull()
    const waited = Date.now() - Date.parse(m![1])
    expect(Math.abs(waited - UNREADABLE_RETRY_MINUTES * 60_000)).toBeLessThan(5_000)
  })

  it('never fetches a private or loopback address from a feed, and records it as no photo', async () => {
    state.rows = [
      { id: 'meta', url: 'http://169.254.169.254/latest/meta-data/' },
      { id: 'local', url: 'http://localhost:8080/admin' },
    ]
    const stats: RunStats = {}
    await fillMissingImages(stats, Date.now() + 10_000)
    expect(fetch).not.toHaveBeenCalled()
    expect(state.updates.map((u) => u.payload.image_url)).toEqual([null, null])
    expect(stats.images_none).toBe(2)
  })

  it('does not follow a redirect into a private address', async () => {
    state.rows = [{ id: 'hop', url: 'https://news.example/redirect' }]
    vi.stubGlobal('fetch', vi.fn(async (href: string) =>
      href === 'https://news.example/redirect'
        ? new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/' } })
        : new Response('<meta property="og:image" content="https://cdn.example/x.jpg">', { status: 200 })))
    const stats: RunStats = {}
    await fillMissingImages(stats, Date.now() + 10_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(state.updates).toEqual([])
    expect(stats.images_unreadable).toBe(1)
  })

  it('does not fail the run when the worklist query errors', async () => {
    state.selectError = 'boom'
    const stats: RunStats = {}
    await fillMissingImages(stats, Date.now() + 10_000)
    expect(stats.images_error).toContain('boom')
    expect(state.updates).toEqual([])
  })
})

describe('isFetchableArticleUrl', () => {
  it.each([
    ['https://www.aljazeera.com/news/2026/9/22/x', true],
    ['http://news.example/a', true],
    ['https://93.184.216.34/a', true],
    ['ftp://news.example/a', false],
    ['https://user:pass@news.example/a', false],
    ['http://127.0.0.1/', false],
    ['http://10.1.2.3/', false],
    ['http://172.20.0.1/', false],
    ['http://192.168.1.1/', false],
    ['http://169.254.169.254/latest/meta-data/', false],
    ['http://100.64.0.1/', false],
    ['http://[::1]/', false],
    ['http://[fd00::1]/', false],
    ['http://[fe80::1]/', false],
    ['http://[::ffff:127.0.0.1]/', false],
    ['http://metadata.google.internal/', false],
    ['http://printer.local/', false],
    ['not a url', false],
  ])('%s → %s', (url, ok) => {
    expect(isFetchableArticleUrl(url)).toBe(ok)
  })
})
