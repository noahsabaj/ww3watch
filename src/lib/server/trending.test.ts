import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  articlesResult: { data: [] as unknown[], error: null as unknown },
  deleteResult: { error: null as unknown },
  insertResult: { error: null as unknown },
  trendingLogResult: { error: null as unknown },
  deleteCalled: false,
  insertedRows: null as unknown[] | null,
  trendingLogInserted: null as unknown,
}))

vi.mock('./llm', () => ({ callLLM: vi.fn() }))
vi.mock('./supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'articles') {
        const b = {
          select: () => b,
          gte: () => b,
          order: () => b,
          limit: () => Promise.resolve(state.articlesResult),
        }
        return b
      }
      if (table === 'trending_log') {
        return {
          insert: (row: unknown) => {
            state.trendingLogInserted = row
            return Promise.resolve(state.trendingLogResult)
          },
        }
      }
      // table === 'trending'
      return {
        delete: () => ({
          neq: () => {
            state.deleteCalled = true
            return Promise.resolve(state.deleteResult)
          },
        }),
        insert: (rows: unknown[]) => {
          state.insertedRows = rows
          return Promise.resolve(state.insertResult)
        },
      }
    },
  },
}))

import { callLLM } from './llm'
import { updateTrending } from './trending'

const mockedCallLLM = vi.mocked(callLLM)

function article(id: string, title: string, source: string, storyId: string | null) {
  return {
    id,
    guid: id,
    title,
    url: `https://example.com/${id}`,
    summary: null,
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_name: source,
    source_region: 'US/Western',
    source_lang: 'en',
    source_affiliation: null,
    feed_url: 'https://example.com/rss',
    source_id: null,
    body_hash: null,
    story_id: storyId,
    cluster_id: null,
  }
}

beforeEach(() => {
  mockedCallLLM.mockReset()
  state.articlesResult = { data: [], error: null }
  state.deleteResult = { error: null }
  state.insertResult = { error: null }
  state.trendingLogResult = { error: null }
  state.deleteCalled = false
  state.insertedRows = null
  state.trendingLogInserted = null
})

describe('updateTrending', () => {
  // 4 clusters: one LLM-assigned cluster (2 articles, 2 distinct sources) + 3 singles.
  const recent = [
    article('a1', 'Strike on Haifa port reported', 'Reuters', 's-haifa'),
    article('a2', 'Haifa port hit in strike', 'AP', 's-haifa'),
    article('b', 'Coup attempt in Sahel state', 'BBC', null),
    article('c', 'Carrier group moves to gulf', 'CNN', null),
    article('d', 'Ceasefire talks stall again', 'DW', null),
  ]

  it('groups by story_id (distinct sources) and inserts ranked unique picks', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedCallLLM.mockResolvedValue('[0,1,2]')
    await updateTrending()

    // groupByStoryId: the s-haifa story (2 distinct sources) sorts first by
    // independent-source count, so the prompt shows it as "2 independent sources".
    const prompt = mockedCallLLM.mock.calls[0][0][1].content
    expect(prompt).toContain('[2 independent sources')
    expect(state.deleteCalled).toBe(true)
    expect(state.insertedRows).toHaveLength(3)
    const first = state.insertedRows![0] as { rank: number; article_id: string; story_id: string | null }
    expect(first.rank).toBe(0)
    // story_id rides along for new clients; article_id stays the newest-member
    // id for N-1 clients (membership resolution).
    expect(first.story_id).toBe('s-haifa')
    expect(['a1', 'a2']).toContain(first.article_id)
    // singletons carry a null story_id
    const singles = (state.insertedRows as Array<{ story_id: string | null }>).slice(1)
    expect(singles.every((r) => r.story_id === null)).toBe(true)

    // The same picks are appended to trending_log (the /about history trail),
    // denormalized with display fields so they survive article pruning.
    const logged = state.trendingLogInserted as { picks: Array<{ article_id: string; rank: number; title: string; source_name: string; source_region: string }> }
    expect(logged.picks).toHaveLength(3)
    expect(logged.picks[0].rank).toBe(0)
    expect(logged.picks[0].title).toBeTruthy()
    expect(logged.picks[0].source_name).toBeTruthy()
  })

  it('a trending_log append failure is non-fatal (trending still updated)', async () => {
    state.articlesResult = { data: recent, error: null }
    state.trendingLogResult = { error: { message: 'log boom' } }
    mockedCallLLM.mockResolvedValue('[0,1,2]')
    const result = await updateTrending()
    expect(result).toBe('updated:3')
    expect(state.insertedRows).toHaveLength(3)
  })

  it('collapses wire reprints in the independent-source count shown to the curator', async () => {
    // Same story: two members share a body_hash (a wire copy) + one original.
    const wireA = { ...article('w1', 'Wire copy', 'Reuters', 's-wire'), body_hash: 'h1', published_at: '2026-06-10T10:00:00Z' }
    const wireB = { ...article('w2', 'Wire copy', 'AP', 's-wire'), body_hash: 'h1', published_at: '2026-06-10T10:05:00Z' }
    const indep = { ...article('w3', 'Original reporting', 'BBC', 's-wire'), body_hash: null, published_at: '2026-06-10T10:03:00Z' }
    state.articlesResult = { data: [wireA, wireB, indep], error: null }
    mockedCallLLM.mockResolvedValue('[0,0,0]') // invalid (one cluster) → no insert, but the prompt is still built
    await updateTrending()
    const prompt = mockedCallLLM.mock.calls[0][0][1].content
    // AP is the later reprint of h1 → excluded; independent sources = Reuters + BBC = 2, not 3.
    expect(prompt).toContain('[2 independent sources')
    expect(state.insertedRows).toBeNull()
  })

  it('rejects duplicate indices and keeps the previous selection (no delete)', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedCallLLM.mockResolvedValue('[1,1,0]')
    await updateTrending()
    expect(state.deleteCalled).toBe(false)
    expect(state.insertedRows).toBeNull()
  })

  it('aborts before insert when the delete fails', async () => {
    state.articlesResult = { data: recent, error: null }
    state.deleteResult = { error: { message: 'boom' } }
    mockedCallLLM.mockResolvedValue('[0,1,2]')
    await updateTrending()
    expect(state.deleteCalled).toBe(true)
    expect(state.insertedRows).toBeNull()
  })

  it('does nothing when there are no recent articles', async () => {
    state.articlesResult = { data: [], error: null }
    await updateTrending()
    expect(mockedCallLLM).not.toHaveBeenCalled()
    expect(state.deleteCalled).toBe(false)
  })
})
