import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  articlesResult: { data: [] as unknown[], error: null as unknown },
  rpcResult: { error: null as unknown },
  rpcCalled: false,
  rpcParams: null as { p_rows: unknown[]; p_log_picks: unknown[] } | null,
  // The live selection's newest selected_at (null = no selection).
  selectedAt: null as string | null,
  // Ids whose titles were asked for, one entry per request.
  titleReads: [] as string[][],
  titleError: null as unknown,
}))

vi.mock('./trending-jev', () => ({ rankWithJev: vi.fn() }))
vi.mock('./supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'articles') {
        let columns = ''
        const b = {
          select: (c: string) => ((columns = c), b),
          gte: () => b,
          order: () => b,
          // The window read: what was selected, so a test sees no title it did not ask for.
          limit: () => {
            const { data, error } = state.articlesResult
            const cols = columns.split(',').map((c) => c.trim())
            const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))
            return Promise.resolve({ data: error ? null : rows, error })
          },
          // The candidates' titles.
          in: (_col: string, ids: string[]) => {
            state.titleReads.push(ids)
            if (state.titleError) return Promise.resolve({ data: null, error: state.titleError })
            const rows = (state.articlesResult.data as Array<{ id: string; title: string }>).filter((r) => ids.includes(r.id))
            return Promise.resolve({ data: rows.map(({ id, title }) => ({ id, title })), error: null })
          },
        }
        return b
      }
      if (table === 'trending') {
        const t = {
          select: () => t,
          order: () => t,
          limit: () => t,
          maybeSingle: () =>
            Promise.resolve({ data: state.selectedAt ? { selected_at: state.selectedAt } : null, error: null }),
        }
        return t
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

import { rankWithJev } from './trending-jev'
import { updateTrending, trendingStuck, TRENDING_MIN_INTERVAL_MS, TRENDING_STUCK_MS } from './trending'

const mockedRank = vi.mocked(rankWithJev)
const picks = (...indices: number[]) => ({ indices, scores: indices.map(() => 0.5) })

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
  mockedRank.mockReset()
  state.articlesResult = { data: [], error: null }
  state.rpcResult = { error: null }
  state.rpcCalled = false
  state.rpcParams = null
  state.selectedAt = null
  state.titleReads = []
  state.titleError = null
})

describe('updateTrending', () => {
  // 4 clusters: one pipeline-assigned cluster (2 articles, 2 distinct sources) + 3 singles.
  const recent = [
    article('a1', 'Strike on Haifa port reported', 'Reuters', 's-haifa'),
    article('a2', 'Haifa port hit in strike', 'AP', 's-haifa'),
    article('b', 'Coup attempt in Sahel state', 'BBC', null),
    article('c', 'Carrier group moves to gulf', 'CNN', null),
    article('d', 'Ceasefire talks stall again', 'DW', null),
  ]

  it('groups by story_id (distinct sources) and atomically replaces trending picks via RPC', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedRank.mockResolvedValue(picks(0, 1, 2))
    const result = await updateTrending()

    expect(result).toBe('updated:3')
    const candidates = mockedRank.mock.calls[0][0]
    expect(candidates[0].independent).toBe(2)
    expect(candidates[0].otherHeadlines).toHaveLength(1)
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

  it('reads headlines for the candidates alone, and gives Jev the same ones', async () => {
    const singles = Array.from({ length: 25 }, (_, i) => article(`x${i}`, `Single story ${i}`, `Outlet ${i}`, null))
    state.articlesResult = { data: [...recent.slice(0, 2), ...singles], error: null }
    mockedRank.mockResolvedValue(picks(0, 1, 2))
    await updateTrending()
    const candidates = mockedRank.mock.calls[0][0]
    expect(candidates).toHaveLength(20)
    // The two-source story and 19 singles: 21 members, not all 27 rows.
    const asked = state.titleReads.flat()
    expect(asked).toHaveLength(21)
    expect(asked).toEqual(expect.arrayContaining(['a1', 'a2']))
    expect(candidates[0]).toMatchObject({ independent: 2, otherHeadlines: [expect.stringMatching(/Haifa/)] })
    expect(candidates[0].headline).toMatch(/Haifa/)
    expect(candidates.slice(1).every((c: { headline: string }) => /^Single story \d+$/.test(c.headline))).toBe(true)
    const log = state.rpcParams!.p_log_picks as Array<{ title: string }>
    expect(log.every((p) => p.title.length > 0)).toBe(true)
  })

  it('keeps the previous selection when the headlines cannot be read', async () => {
    state.articlesResult = { data: recent, error: null }
    state.titleError = { message: 'boom' }
    expect(await updateTrending()).toBe('error:fetch')
    expect(state.rpcCalled).toBe(false)
  })

  it('writes the picks in the order the ranking returned them', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedRank.mockResolvedValue(picks(2, 0, 1))
    await updateTrending()
    const rows = state.rpcParams!.p_rows as Array<{ rank: number; story_id: string | null }>
    expect(rows.map((r) => r.rank)).toEqual([0, 1, 2])
    expect(rows[1].story_id).toBe('s-haifa')
  })

  it('collapses wire reprints in the independent-source count, and keeps them out of the headlines Jev sees', async () => {
    const wireA = { ...article('w1', 'Wire copy', 'Reuters', 's-wire'), body_hash: 'h1', published_at: '2026-06-10T10:00:00Z' }
    const wireB = { ...article('w2', 'Wire copy', 'AP', 's-wire'), body_hash: 'h1', published_at: '2026-06-10T10:05:00Z' }
    const indep = { ...article('w3', 'Original reporting', 'BBC', 's-wire'), body_hash: null, published_at: '2026-06-10T10:03:00Z' }
    state.articlesResult = {
      data: [wireA, wireB, indep, article('p1', 'Padding one', 'DW', null), article('p2', 'Padding two', 'CNN', null), article('p3', 'Padding three', 'NPR', null)],
      error: null,
    }
    mockedRank.mockResolvedValue(picks(0, 1, 2))
    await updateTrending()
    const story = mockedRank.mock.calls[0][0][0]
    expect(story.independent).toBe(2)
    expect([story.headline, ...story.otherHeadlines].filter((h) => h === 'Wire copy').length).toBeLessThanOrEqual(1)
  })

  it('writes all candidates without asking Jev when there are fewer than PICK_COUNT', async () => {
    state.articlesResult = { data: [article('only', 'The one story in the window', 'Reuters', null)], error: null }
    const result = await updateTrending()

    expect(mockedRank).not.toHaveBeenCalled()
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

    expect(mockedRank).not.toHaveBeenCalled()
    expect(result).toBe('updated:2')
    const rows = state.rpcParams!.p_rows as Array<{ rank: number; story_id: string | null }>
    expect(rows[0].rank).toBe(0)
    expect(rows[0].story_id).toBe('s-two')
    expect(rows[1].story_id).toBeNull()
  })

  it('keeps the previous selection when too few candidates could be judged', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedRank.mockResolvedValue(null)
    expect(await updateTrending()).toBe('error:jev')
    expect(state.rpcCalled).toBe(false)
  })

  it('keeps the previous selection when the ranking throws', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedRank.mockRejectedValue(new Error('network'))
    expect(await updateTrending()).toBe('error:jev')
    expect(state.rpcCalled).toBe(false)
  })

  it('handles replace_trending RPC errors gracefully', async () => {
    state.articlesResult = { data: recent, error: null }
    state.rpcResult = { error: { message: 'RPC boom' } }
    mockedRank.mockResolvedValue(picks(0, 1, 2))
    const result = await updateTrending()
    expect(state.rpcCalled).toBe(true)
    expect(result).toBe('error:rpc')
  })

  it('does nothing when there are no recent articles', async () => {
    state.articlesResult = { data: [], error: null }
    await updateTrending()
    expect(mockedRank).not.toHaveBeenCalled()
    expect(state.rpcCalled).toBe(false)
  })

  it('passes the run deadline through to the ranking', async () => {
    state.articlesResult = { data: recent, error: null }
    mockedRank.mockResolvedValue(picks(0, 1, 2))
    const deadline = Date.now() + 60_000
    await updateTrending(deadline)
    expect(mockedRank).toHaveBeenCalledWith(expect.anything(), 3, deadline, expect.anything(), expect.anything())
  })

  it('reports an exhausted run budget as deferred:budget, without asking Jev', async () => {
    state.articlesResult = { data: recent, error: null }
    const result = await updateTrending(Date.now() - 1)
    expect(result).toBe('deferred:budget')
    expect(mockedRank).not.toHaveBeenCalled()
    expect(state.rpcCalled).toBe(false)
  })

  it('skips curation while the live selection is younger than the minimum interval', async () => {
    state.articlesResult = { data: recent, error: null }
    state.selectedAt = new Date(Date.now() - TRENDING_MIN_INTERVAL_MS / 2).toISOString()
    const result = await updateTrending()
    expect(result).toBe('fresh:skipped')
    expect(mockedRank).not.toHaveBeenCalled()
    expect(state.rpcCalled).toBe(false)
  })

  it('re-curates once the live selection is older than the minimum interval', async () => {
    state.articlesResult = { data: recent, error: null }
    state.selectedAt = new Date(Date.now() - TRENDING_MIN_INTERVAL_MS - 1000).toISOString()
    mockedRank.mockResolvedValue(picks(0, 1, 2))
    expect(await updateTrending()).toBe('updated:3')
  })
})

describe('trendingStuck', () => {
  const now = Date.parse('2026-09-13T12:00:00Z')
  const fresh = new Date(now - 60_000).toISOString()
  const old = new Date(now - TRENDING_STUCK_MS - 60_000).toISOString()

  it('is only ever raised by an error status', () => {
    for (const status of ['updated:3', 'empty', 'fresh:skipped', 'deferred:budget']) {
      expect(trendingStuck(status, old, now)).toBe(false)
      expect(trendingStuck(status, null, now)).toBe(false)
    }
  })
  it('tolerates a single failure on top of a recent selection', () => {
    expect(trendingStuck('error:rpc', fresh, now)).toBe(false)
  })
  it('fires when the failure sits on a selection nobody has replaced for hours, or none at all', () => {
    expect(trendingStuck('error:rpc', old, now)).toBe(true)
    expect(trendingStuck('error:jev', null, now)).toBe(true)
  })
})
