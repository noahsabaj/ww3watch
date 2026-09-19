import { describe, it, expect } from 'vitest'
import type { Article } from './types'
import { bySide, corroboration, importance, memberKind, storySignals } from './story'

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

describe('importance', () => {
  const now = Date.parse('2026-09-19T12:00:00Z')
  it('puts a corroborated major event above a fresher lone statement', () => {
    const strike = [event({ source_region: 'Russian', source_lang: 'ru' }), event({ source_region: 'Ukrainian', source_lang: 'uk' }), event()]
    const threat = [statement()]
    expect(importance(strike, now - 6 * 3_600_000, now)).toBeGreaterThan(importance(threat, now - 600_000, now))
  })
  it('decays: the same story is worth less a day later', () => {
    const s = [event(), event()]
    expect(importance(s, now - 3_600_000, now)).toBeGreaterThan(importance(s, now - 25 * 3_600_000, now))
  })
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
