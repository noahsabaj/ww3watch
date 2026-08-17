import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  articlesResult: { data: [] as unknown[], error: null as unknown },
  rpcResult: { error: null as unknown },
  rpcCalled: false,
  rpcParams: null as { p_rows: unknown[]; p_log_picks: unknown[] } | null,
}))

// importOriginal, not a bare object: trending.ts narrows failures with
// `err instanceof LLMDeadlineError`, and a mock that omits the class makes that
// check throw TypeError instead of matching.
vi.mock('./llm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./llm')>()),
  callLLM: vi.fn(),
}))
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
      return {}
    },
    rpc: (name: string, params: unknown) => {
      if (name === 'replace_trending') {
        state.rpcCalled = true
        state.rpcParams = params as { p_rows: unknown[]; p_log_picks: unknown[] }
        return Promise.resolve(state.rpcResult)
      }
      return Promise.resolve({ data: null, error: null })
    },
  },
}))

import { callLLM, LLMDeadlineError } from './llm'
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
  }
}

beforeEach(() => {
  mockedCallLLM.mockReset()
  state.articlesResult = { data: [], error: null }
  state.rpcResult = { error: null }
  state.rpcCalled = false
  state.rpcParams = null
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

  it('groups by story_id (distinct sources) and atomically replaces trending picks via RPC', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedCallLLM.mockResolvedValue('[0,1,2]')
    const result = await updateTrending()

    expect(result).toBe('updated:3')
    const prompt = mockedCallLLM.mock.calls[0][0][1].content
    expect(prompt).toContain('[2 independent sources')
    expect(state.rpcCalled).toBe(true)
    expect(state.rpcParams?.p_rows).toHaveLength(3)
    const first = state.rpcParams!.p_rows[0] as { rank: number; article_id: string; story_id: string | null }
    expect(first.rank).toBe(0)
    expect(first.story_id).toBe('s-haifa')
    expect(['a1', 'a2']).toContain(first.article_id)
    const singles = (state.rpcParams!.p_rows as Array<{ story_id: string | null }>).slice(1)
    expect(singles.every((r) => r.story_id === null)).toBe(true)

    // Log picks passed to RPC for single transaction commit
    expect(state.rpcParams?.p_log_picks).toHaveLength(3)
    const firstLog = state.rpcParams!.p_log_picks[0] as { rank: number; title: string; source_name: string }
    expect(firstLog.rank).toBe(0)
    expect(firstLog.title).toBeTruthy()
    expect(firstLog.source_name).toBeTruthy()
  })

  it('collapses wire reprints in the independent-source count shown to the curator', async () => {
    const wireA = { ...article('w1', 'Wire copy', 'Reuters', 's-wire'), body_hash: 'h1', published_at: '2026-06-10T10:00:00Z' }
    const wireB = { ...article('w2', 'Wire copy', 'AP', 's-wire'), body_hash: 'h1', published_at: '2026-06-10T10:05:00Z' }
    const indep = { ...article('w3', 'Original reporting', 'BBC', 's-wire'), body_hash: null, published_at: '2026-06-10T10:03:00Z' }
    state.articlesResult = {
      data: [wireA, wireB, indep, article('p1', 'Padding one', 'DW', null), article('p2', 'Padding two', 'CNN', null), article('p3', 'Padding three', 'NPR', null)],
      error: null,
    }
    mockedCallLLM.mockResolvedValue('[0,0,0]') // duplicate indices → rejected, no RPC call
    await updateTrending()
    const prompt = mockedCallLLM.mock.calls[0][0][1].content
    expect(prompt).toContain('[2 independent sources')
    expect(state.rpcCalled).toBe(false)
  })

  it('writes all candidates without an LLM call when there are fewer than PICK_COUNT', async () => {
    state.articlesResult = { data: [article('only', 'The one story in the window', 'Reuters', null)], error: null }
    const result = await updateTrending()

    expect(mockedCallLLM).not.toHaveBeenCalled()
    expect(result).toBe('updated:1')
    expect(state.rpcCalled).toBe(true)
    expect(state.rpcParams?.p_rows).toHaveLength(1)
    expect((state.rpcParams!.p_rows[0] as { article_id: string }).article_id).toBe('only')
  })

  it('ranks the forced selection by independent source count', async () => {
    state.articlesResult = {
      data: [
        article('s1', 'Two-source story', 'Reuters', 's-two'),
        article('s2', 'Two-source story echoed', 'AP', 's-two'),
        article('lone', 'One-source story', 'BBC', null),
      ],
      error: null,
    }
    const result = await updateTrending()

    expect(mockedCallLLM).not.toHaveBeenCalled()
    expect(result).toBe('updated:2')
    const rows = state.rpcParams!.p_rows as Array<{ rank: number; story_id: string | null }>
    expect(rows[0].rank).toBe(0)
    expect(rows[0].story_id).toBe('s-two')
    expect(rows[1].story_id).toBeNull()
  })

  it('rejects duplicate indices and keeps the previous selection (no RPC call)', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedCallLLM.mockResolvedValue('[1,1,0]')
    await updateTrending()
    expect(state.rpcCalled).toBe(false)
  })

  it('handles replace_trending RPC errors gracefully', async () => {
    state.articlesResult = { data: recent, error: null }
    state.rpcResult = { error: { message: 'RPC boom' } }
    mockedCallLLM.mockResolvedValue('[0,1,2]')
    const result = await updateTrending()
    expect(state.rpcCalled).toBe(true)
    expect(result).toBe('error:rpc')
  })

  it('does nothing when there are no recent articles', async () => {
    state.articlesResult = { data: [], error: null }
    await updateTrending()
    expect(mockedCallLLM).not.toHaveBeenCalled()
    expect(state.rpcCalled).toBe(false)
  })

  it('passes the run deadline through to callLLM', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedCallLLM.mockResolvedValue('[0,1,2]')
    const deadline = Date.now() + 60_000
    await updateTrending(deadline)
    expect(mockedCallLLM).toHaveBeenCalledWith(expect.anything(), expect.any(Number), deadline)
  })

  it('reports a budget deferral as deferred:budget, not error:llm', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedCallLLM.mockRejectedValue(new LLMDeadlineError())
    const result = await updateTrending(Date.now() - 1)
    expect(result).toBe('deferred:budget')
    expect(state.rpcCalled).toBe(false)
  })
})
