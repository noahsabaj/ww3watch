import { describe, it, expect, vi, beforeEach } from 'vitest'

// checkAlerts runs every 5 minutes over 12 hours of story members; egress is
// metered, so it scans only the reports at the top of the severity scale,
// counts only their stories, and fetches text only for stories that qualify.
type Read = { columns: string; stories?: string[]; minSeverity?: number }
const db = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, reads: [] as Read[] }))

vi.mock('../supabase', () => {
  const articles = () => {
    const read: Read = { columns: '' }
    const q = {
      select: (columns: string) => ((read.columns = columns), q),
      gte: (col: string, value: unknown) => (col === 'severity' && (read.minSeverity = value as number), q),
      not: () => q,
      in: (_col: string, ids: string[]) => ((read.stories = ids), q),
      order: () => q,
      range: () => {
        db.reads.push(read)
        const cols = read.columns.split(',').map((c) => c.trim())
        const data = db.rows
          .filter((r) => !read.stories || read.stories.includes(r.story_id as string))
          .filter((r) => read.minSeverity === undefined || (r.severity as number) >= read.minSeverity)
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
  it('scans only top-severity reports, without text, and stops when there are none', async () => {
    db.rows = Array.from({ length: 6 }, () => row('small', 0.3))
    await checkAlerts({} as never, Date.now() + 60_000)
    expect(db.reads).toHaveLength(1)
    expect(db.reads[0].columns).not.toMatch(/title|summary/)
    expect(db.reads[0].minSeverity).toBeGreaterThan(0.8)
  })

  it('counts outlets over the stories with a grave report only, every member of them', async () => {
    db.rows = [
      row('mixed', 0.9), ...Array.from({ length: 4 }, () => row('mixed', 0.3)),
      ...Array.from({ length: 6 }, () => row('quiet', 0.5)),
    ]
    const stats: Record<string, unknown> = {}
    await checkAlerts(stats as never, Date.now() + 60_000)
    expect(db.reads.map((r) => r.stories)).toEqual([undefined, ['mixed'], ['mixed']])
    // Five outlets in four regions, one of them grave: it qualifies on all five.
    expect(db.reads[2].columns).toMatch(/title, summary/)
    expect(stats.alerts_error).toBeUndefined()
  })

  it('fetches the text only for the stories that qualify', async () => {
    db.rows = [
      ...Array.from({ length: 5 }, () => row('grave', 0.95)),
      // Grave, but two outlets: counted, and turned away without its text.
      ...Array.from({ length: 2 }, () => row('narrow', 0.95)),
      ...Array.from({ length: 3 }, () => row('small', 0.3)),
    ]
    const stats: Record<string, unknown> = {}
    await checkAlerts(stats as never, Date.now() + 60_000)
    expect(db.reads).toHaveLength(3)
    expect(db.reads[1].stories).toEqual(['grave', 'narrow'])
    expect(db.reads[2].columns).toMatch(/title, summary/)
    expect(db.reads[2].stories).toEqual(['grave'])
    expect(stats.alerts_error).toBeUndefined()
  })
})
