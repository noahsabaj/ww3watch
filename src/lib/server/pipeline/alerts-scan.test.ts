import { describe, it, expect, vi, beforeEach } from 'vitest'

// checkAlerts reads every fresh story member each run; egress is metered, so
// the scan leaves out the text and fetches it only for stories that qualify.
const db = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, reads: [] as Array<{ columns: string; stories?: string[] }> }))

vi.mock('../supabase', () => {
  const articles = () => {
    const read: { columns: string; stories?: string[] } = { columns: '' }
    const q = {
      select: (columns: string) => ((read.columns = columns), q),
      gte: () => q,
      not: () => q,
      in: (_col: string, ids: string[]) => ((read.stories = ids), q),
      order: () => q,
      range: () => {
        db.reads.push(read)
        const cols = read.columns.split(',').map((c) => c.trim())
        const data = db.rows
          .filter((r) => !read.stories || read.stories.includes(r.story_id as string))
          .map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))
        return Promise.resolve({ data, error: null })
      },
    }
    return q
  }
  const alerts = () => {
    const q: Record<string, unknown> = {}
    Object.assign(q, {
      select: () => q, order: () => q, eq: () => Promise.resolve({ error: null }),
      limit: () => Promise.resolve({ data: [], error: null }),
      upsert: () => q, single: () => Promise.resolve({ data: { id: 1 }, error: null }),
      update: () => q,
    })
    return q
  }
  return { supabaseAdmin: { from: (t: string) => (t === 'articles' ? articles() : alerts()) } }
})
vi.mock('../jev', () => ({ callJev: vi.fn(async () => ({ answers: { confirm: { noul: 0.01 } }, inputTokens: 1 })) }))

const { checkAlerts } = await import('./alerts')

let n = 0
const row = (story: string, severity: number) => ({
  story_id: story, title: `headline ${++n}`, summary: `summary ${n}`, source_name: `S${n}`, source_region: `R${n % 4}`,
  source_lang: 'en', published_at: new Date().toISOString(), severity, opinion: 0.05, retrospective: 0.02,
})

beforeEach(() => {
  db.reads = []
  n = 0
})

describe('checkAlerts reads', () => {
  it('scans without titles or summaries when nothing qualifies, and stops there', async () => {
    db.rows = Array.from({ length: 6 }, () => row('small', 0.3))
    await checkAlerts({} as never, Date.now() + 60_000)
    expect(db.reads).toHaveLength(1)
    expect(db.reads[0].columns).not.toMatch(/title|summary/)
  })

  it('fetches the text only for the stories that qualify', async () => {
    db.rows = [...Array.from({ length: 5 }, () => row('grave', 0.95)), ...Array.from({ length: 3 }, () => row('small', 0.3))]
    const stats: Record<string, unknown> = {}
    await checkAlerts(stats as never, Date.now() + 60_000)
    expect(db.reads).toHaveLength(2)
    expect(db.reads[1].columns).toMatch(/title, summary/)
    expect(db.reads[1].stories).toEqual(['grave'])
    expect(stats.alerts_error).toBeUndefined()
  })
})
