import { describe, it, expect } from 'vitest'
import type { Article } from './types'
import { byOutlet, bySide, corroboration, memberKind, storySignals } from './story'

let n = 0
function art(o: Partial<Article> = {}): Article {
  n++
  return {
    id: `a${n}`, title: `t${n}`, url: `https://x/${n}`, summary: null,
    published_at: '2026-09-19T10:00:00Z', fetched_at: '2026-09-19T10:01:00Z',
    source_name: `S${n}`, source_region: 'US/Western', source_lang: 'en',
    source_affiliation: null, body_hash: null, story_id: 's',
    ...o,
  } as Article
}
const event = (o: Partial<Article> = {}) => art({ severity: 0.67, claim: 0.05, unverified: 0.1, opinion: 0.05, ...o })
const statement = (o: Partial<Article> = {}) => art({ severity: 0.1, claim: 0.95, unverified: 0.2, opinion: 0.05, ...o })

describe('memberKind', () => {
  it('is null until annotated, then analysis > statement > event', () => {
    expect(memberKind(art())).toBeNull()
    expect(memberKind(event())).toBe('event')
    expect(memberKind(statement())).toBe('statement')
    expect(memberKind(art({ claim: 0.9, opinion: 0.9 }))).toBe('analysis')
  })
})

describe('storySignals', () => {
  it('is major when any independent member reports a significant event', () => {
    const s = storySignals([statement(), event(), art()])
    expect(s.major).toBe(true)
    expect(s.topSeverity).toBeCloseTo(0.67)
    expect(s.talkOnly).toBe(false)
  })

  it('does not let a wire reprint make a story major or count as a source', () => {
    const origin = statement({ body_hash: 'h', published_at: '2026-09-19T09:00:00Z' })
    const reprint = event({ body_hash: 'h', published_at: '2026-09-19T09:30:00Z' })
    const s = storySignals([origin, reprint])
    expect(s.major).toBe(false)
    expect(s.independent).toBe(1)
  })

  it('is unconfirmed only when EVERY annotated member hedges', () => {
    const hedged = event({ unverified: 0.95 })
    expect(storySignals([hedged, event({ unverified: 0.9 })]).unconfirmed).toBe(true)
    expect(storySignals([hedged, event({ unverified: 0.1 })]).unconfirmed).toBe(false)
    expect(storySignals([art()]).unconfirmed).toBe(false) // nothing annotated → no claim either way
  })

  it('is talk-only when nobody reports something that happened', () => {
    expect(storySignals([statement(), art({ claim: 0.2, opinion: 0.9 })]).talkOnly).toBe(true)
    expect(storySignals([statement(), event()]).talkOnly).toBe(false)
  })
})

describe('corroboration', () => {
  it('saturates corroboration', () => {
    expect(corroboration({ independent: 500, regions: 50, langs: 50 })).toBeCloseTo(1)
  })
})

describe('bySide', () => {
  it('groups by region and splits state outlets out of their region', () => {
    const groups = bySide([
      art({ source_region: 'Iranian', source_affiliation: 'state' }),
      art({ source_region: 'Iranian', source_affiliation: 'exile' }),
      art({ source_region: 'Iranian', source_affiliation: 'state' }),
      art({ source_region: 'Israeli' }),
    ])
    expect(groups.map((g) => [g.region, g.affiliation, g.articles.length])).toEqual([
      ['Iranian', 'state', 2],
      ['Iranian', null, 1],
      ['Israeli', null, 1],
    ])
  })
})

describe('byOutlet', () => {
  const at = (h: number) => `2026-09-23T${String(h).padStart(2, '0')}:00:00Z`
  const ria1 = art({ source_name: 'RIA Novosti', published_at: at(10) })
  const tass = art({ source_name: 'TASS', published_at: at(11) })
  const ria2 = art({ source_name: 'RIA Novosti', published_at: at(12) })
  const ria3 = art({ source_name: 'RIA Novosti', published_at: at(13) })
  const chronological = [ria1, tass, ria2, ria3]

  it("folds an outlet's reports under its newest", () => {
    const rows = byOutlet([ria3, ria2, tass, ria1], 'newest')
    expect(rows.map((r) => r.lead)).toEqual([ria3, tass])
    expect(rows[0].more).toEqual([ria1, ria2])
    expect(rows[1].more).toEqual([])
  })

  it('leads with the first report for a timeline, keeping the input order', () => {
    const rows = byOutlet(chronological, 'first')
    expect(rows.map((r) => r.lead)).toEqual([ria1, tass])
    expect(rows[0].more).toEqual([ria2, ria3])
  })

  it('never leads with an undated report', () => {
    const undated = art({ source_name: 'TASS', published_at: null })
    expect(byOutlet([undated, tass], 'newest')[0].lead).toBe(tass)
    expect(byOutlet([undated, tass], 'first')[0].lead).toBe(tass)
  })
})
