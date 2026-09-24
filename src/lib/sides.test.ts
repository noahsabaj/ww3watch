import { describe, it, expect } from 'vitest'
import type { Article } from './types'
import { blocOf, sideLabel, storySides } from './sides'

let n = 0
function art(o: Partial<Article>): Article {
  n++
  return {
    id: `a${n}`, title: `t${n}`, url: `https://x/${n}`, summary: null,
    published_at: '2026-09-23T10:00:00Z', fetched_at: '2026-09-23T10:01:00Z',
    source_name: `S${n}`, source_region: 'US/Western', source_lang: 'en',
    source_affiliation: null, body_hash: null, story_id: 's', actors: ['russia', 'ukraine'],
    ...o,
  } as Article
}

describe('blocOf', () => {
  it('counts only the outlets that speak for a side', () => {
    expect(blocOf({ source_region: 'Russian', source_affiliation: 'state' })).toBe('russia') // TASS
    expect(blocOf({ source_region: 'Russian', source_affiliation: 'public' })).toBeNull() // Radio Svoboda
    expect(blocOf({ source_region: 'Russian', source_affiliation: 'exile' })).toBeNull() // Meduza
    expect(blocOf({ source_region: 'Chinese', source_affiliation: null })).toBeNull() // SCMP
    expect(blocOf({ source_region: 'Iranian', source_affiliation: null })).toBe('iran') // Tabnak
    expect(blocOf({ source_region: 'Iranian', source_affiliation: 'public' })).toBeNull() // Radio Farda
    expect(blocOf({ source_region: 'UK', source_affiliation: 'public' })).toBe('west') // BBC
  })

  it('labels a side plainly', () => {
    expect(sideLabel({ source_region: 'Russian', source_affiliation: 'state' })).toBe('Russian state media')
    expect(sideLabel({ source_region: 'Ukrainian', source_affiliation: null })).toBe('Ukrainian media')
    expect(sideLabel({ source_region: 'Arab/Gulf', source_affiliation: null })).toBeNull()
  })
})

describe('storySides', () => {
  const tass = art({ source_name: 'TASS', source_region: 'Russian', source_affiliation: 'state', published_at: '2026-09-23T09:00:00Z' })
  const tassLater = art({ source_name: 'TASS', source_region: 'Russian', source_affiliation: 'state', published_at: '2026-09-23T12:00:00Z' })
  const ukrinform = art({ source_name: 'Ukrinform', source_region: 'Ukrainian', source_affiliation: 'state', published_at: '2026-09-23T09:30:00Z' })
  const reuters = art({ source_name: 'Reuters', source_region: 'US/Western' })

  it("pairs a war's two sides by their first reports, the war's own rivalry first", () => {
    const s = storySides([tassLater, reuters, ukrinform, tass])
    expect(s?.sides).toEqual(['russia', 'ukraine'])
    expect(s?.first.map((a) => a.source_name)).toEqual(['TASS', 'Ukrinform'])
  })

  it('pairs Russian state media with the West on the war in Ukraine', () => {
    expect(storySides([tass, reuters])?.sides).toEqual(['russia', 'west'])
  })

  it('finds no sides when the story is not about the rivalry, or one side is missing', () => {
    const elsewhere = (a: Article) => ({ ...a, actors: ['india_pakistan', 'afghanistan'] as Article['actors'] })
    expect(storySides([elsewhere(tass), elsewhere(reuters)])).toBeNull()
    expect(storySides([tass, tassLater])).toBeNull()
    expect(storySides([art({ source_region: 'Russian', source_affiliation: 'exile' }), ukrinform])).toBeNull()
  })
})
