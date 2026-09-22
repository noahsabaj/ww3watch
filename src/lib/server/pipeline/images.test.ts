import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; url: string }>,
  updates: [] as Array<{ id: string; payload: Record<string, unknown> }>,
  html: {} as Record<string, string>,
  selectError: null as string | null,
}))

vi.mock('../supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        is: () => ({
          gte: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({
                  data: state.selectError ? null : state.rows,
                  error: state.selectError ? { message: state.selectError } : null,
                }),
            }),
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: (col: string, id: string) => {
          if (col === 'id') state.updates.push({ id, payload })
          return Promise.resolve({ error: null })
        },
      }),
    }),
  },
}))

import { fillMissingImages } from './images'
import type { RunStats } from './stats'

beforeEach(() => {
  state.rows = []
  state.updates = []
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

  it('does not fail the run when the worklist query errors', async () => {
    state.selectError = 'boom'
    const stats: RunStats = {}
    await fillMissingImages(stats, Date.now() + 10_000)
    expect(stats.images_error).toContain('boom')
    expect(state.updates).toEqual([])
  })
})
