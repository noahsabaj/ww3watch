import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabaseAdmin: {} }))
const { newestItem } = await import('./sources')

describe('newestItem', () => {
  it('picks the latest pubDate, whatever the feed order', () => {
    expect(newestItem([
      { published_at: '2026-10-01T10:00:00.000Z' },
      { published_at: '2026-10-15T10:33:36.000Z' },
      { published_at: null },
      { published_at: '2026-10-03T17:45:08.000Z' },
    ])).toBe('2026-10-15T10:33:36.000Z')
  })

  it('is null for a 304 (no items) or an undated feed', () => {
    expect(newestItem([])).toBeNull()
    expect(newestItem([{ published_at: null }])).toBeNull()
  })
})
