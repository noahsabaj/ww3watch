import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  articlesResult: { data: [] as unknown[], error: null as unknown },
  deleteResult: { error: null as unknown },
  insertResult: { error: null as unknown },
  deleteCalled: false,
  insertedRows: null as unknown[] | null,
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

function article(id: string, title: string, source: string, clusterId: string | null) {
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
    feed_url: 'https://example.com/rss',
    cluster_id: clusterId,
  }
}

beforeEach(() => {
  mockedCallLLM.mockReset()
  state.articlesResult = { data: [], error: null }
  state.deleteResult = { error: null }
  state.insertResult = { error: null }
  state.deleteCalled = false
  state.insertedRows = null
})

describe('updateTrending', () => {
  // 4 clusters: one LLM-assigned cluster (2 articles, 2 distinct sources) + 3 singles.
  const recent = [
    article('a1', 'Strike on Haifa port reported', 'Reuters', 'a1'),
    article('a2', 'Haifa port hit in strike', 'AP', 'a1'),
    article('b', 'Coup attempt in Sahel state', 'BBC', null),
    article('c', 'Carrier group moves to gulf', 'CNN', null),
    article('d', 'Ceasefire talks stall again', 'DW', null),
  ]

  it('groups by cluster_id (distinct sources) and inserts ranked unique picks', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedCallLLM.mockResolvedValue('[0,1,2]')
    await updateTrending()

    // groupByClusterId: the a1 cluster (2 sources) sorts first, so the prompt
    // shows it as "2 sources" — proving distinct-source counting via the shared path.
    const prompt = mockedCallLLM.mock.calls[0][0][1].content
    expect(prompt).toContain('[2 sources')
    expect(state.deleteCalled).toBe(true)
    expect(state.insertedRows).toHaveLength(3)
    expect((state.insertedRows![0] as { rank: number }).rank).toBe(0)
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
