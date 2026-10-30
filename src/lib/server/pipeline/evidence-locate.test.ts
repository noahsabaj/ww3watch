import { describe, it, expect, vi, beforeEach } from 'vitest'

// Which stories to locate is worked out in the database (stories_to_locate):
// reading every major report of 36 hours and their stories' places to work it
// out here was ~100 KB every 5 minutes. Without the function, the rows are
// read as before.
const db = vi.hoisted(() => ({
  rpc: [] as Array<{ data: unknown; error: unknown }>,
  rpcArgs: [] as unknown[],
  reads: [] as string[],
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  upserts: [] as string[],
}))

vi.mock('../supabase', () => {
  const from = (table: string) => {
    let columns = ''
    const q: Record<string, unknown> = {}
    const result = () => {
      db.reads.push(`${table}: ${columns}`)
      const cols = columns.split(',').map((c) => c.trim())
      return { data: (db.tables[table] ?? []).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null }
    }
    Object.assign(q, {
      select: (c: string) => ((columns = c), q),
      gte: () => q, not: () => q, order: () => q, limit: () => q, in: () => q,
      upsert: () => (db.upserts.push(table), Promise.resolve({ error: null })),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    })
    return q
  }
  const rpc = (fn: string, args: unknown) => {
    db.reads.push(`rpc ${fn}`)
    db.rpcArgs.push(args)
    return Promise.resolve(db.rpc.shift() ?? { data: [], error: null })
  }
  return { supabaseAdmin: { from, rpc } }
})
vi.mock('../jev', () => ({ callJev: vi.fn() }))

// Fresh module per test: whether the function exists is remembered per process.
let locateStories: typeof import('./evidence').locateStories
beforeEach(async () => {
  db.rpc = []
  db.rpcArgs = []
  db.reads = []
  db.upserts = []
  // A major report that names no place: the story is recorded unlocated, and
  // nothing is asked of Jev.
  db.tables = {
    articles: [{ story_id: 's1', title: 'Officials comment', summary: null, published_at: new Date().toISOString(), severity: 0.8, opinion: 0.1, retrospective: 0 }],
    story_places: [],
  }
  vi.resetModules()
  ;({ locateStories } = await import('./evidence'))
})

const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.stories_to_locate' } }
const MEMBERS = 'articles: story_id, title, summary, published_at'

describe('locateStories', () => {
  it('asks the database which stories to locate, then reads only their reports', async () => {
    db.rpc = [{ data: [{ story_id: 's1' }], error: null }]
    const stats: Record<string, unknown> = {}
    await locateStories(stats as never, Date.now() + 60_000)
    expect(db.reads).toEqual(['rpc stories_to_locate', MEMBERS])
    expect(db.rpcArgs[0]).toMatchObject({ p_min_severity: 0.55, p_signal_yes: 0.7, p_limit: 40 })
    expect(db.upserts).toEqual(['story_places'])
    expect(stats.stories_unlocated).toBe(1)
  })

  it('reads the reports and places itself where the function is not applied yet, and keeps doing so', async () => {
    db.rpc = [missing]
    await locateStories({} as never, Date.now() + 60_000)
    await locateStories({} as never, Date.now() + 60_000)
    const rows = ['articles: story_id, severity, opinion, retrospective', 'story_places: story_id, place_id, located_at', MEMBERS]
    expect(db.reads).toEqual(['rpc stories_to_locate', ...rows, ...rows])
  })

  it('fails the stage on any other error rather than locating nothing', async () => {
    db.rpc = [{ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }]
    await expect(locateStories({} as never, Date.now() + 60_000)).rejects.toThrow(/statement timeout/)
  })
})
