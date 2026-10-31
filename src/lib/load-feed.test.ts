import { describe, it, expect, vi, beforeEach } from 'vitest'

// What Supabase answers the articles read: rows, or an error with its status.
const answer = vi.hoisted(() => ({ status: 200, error: null as null | { message: string } }))

vi.mock('#lib/supabase.js', () => {
  const from = (table: string) => {
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      select: () => q, order: () => q, limit: () => q,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const failed = table === 'articles' && answer.error
        return Promise.resolve(
          failed
            ? { data: null, error: answer.error, status: answer.status }
            : { data: table === 'articles' ? [{ id: 'a' }] : [], error: null, status: 200 },
        ).then(resolve, reject)
      },
    })
    return q
  }
  return { supabase: { from, rpc: () => Promise.resolve({ data: null, error: null, status: 200 }) } }
})

const { loadFeed } = await import('./load-feed')

beforeEach(() => {
  answer.status = 200
  answer.error = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('loadFeed', () => {
  it('loads the feed', async () => {
    const r = await loadFeed()
    expect(r.loadError).toBe(false)
    expect(r.restricted).toBe(false)
    expect(r.articles).toHaveLength(1)
  })

  // October 2026: the Free plan's egress quota ran out and every request got
  // 402 until the next billing cycle. Retry cannot help, so the page says so.
  it('tells a quota restriction (402) from other failures', async () => {
    answer.status = 402
    answer.error = { message: 'Payment Required' }
    const r = await loadFeed()
    expect(r.loadError).toBe(true)
    expect(r.restricted).toBe(true)
  })

  it('treats any other failure as a plain load error', async () => {
    for (const status of [0, 500, 503, 401]) {
      answer.status = status
      answer.error = { message: 'nope' }
      const r = await loadFeed()
      expect(r.loadError).toBe(true)
      expect(r.restricted).toBe(false)
    }
  })
})
