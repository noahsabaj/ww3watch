import { describe, it, expect } from 'vitest'
import type { Article, SourceRegion } from './types'
import { ALL_REGIONS } from './types'
import { ALL_TOPICS, emptySignalFilter } from './signals'
import { groupByStoryId } from './cluster'
import {
  countActors,
  countLangs,
  countTopics,
  filterArticles,
  isFilterActive,
  type FilterCriteria,
} from './filters.svelte'

const NOW = Date.parse('2026-09-19T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

let n = 0
function art(o: Partial<Article> = {}): Article {
  n++
  return {
    id: `a${n}`, title: `t${n}`, url: `https://x/${n}`, summary: null,
    published_at: hoursAgo(1), fetched_at: hoursAgo(1),
    source_name: `S${n}`, source_region: 'US/Western', source_lang: 'en',
    source_affiliation: null, body_hash: null, story_id: null,
    ...o,
  } as Article
}

function criteria(o: Partial<FilterCriteria> = {}): FilterCriteria {
  return {
    searchQuery: '',
    activeRegions: new Set<SourceRegion>(ALL_REGIONS),
    excludedLangs: new Set<string>(),
    signalFilter: emptySignalFilter(),
    ...o,
  }
}

describe('isFilterActive', () => {
  it('is false for the defaults and for a whitespace-only search', () => {
    expect(isFilterActive(criteria())).toBe(false)
    expect(isFilterActive(criteria({ searchQuery: '   ' }))).toBe(false)
  })

  it('is true for each kind of narrowing', () => {
    expect(isFilterActive(criteria({ searchQuery: 'x' }))).toBe(true)
    expect(isFilterActive(criteria({ activeRegions: new Set<SourceRegion>(['UK']) }))).toBe(true)
    expect(isFilterActive(criteria({ activeRegions: new Set<SourceRegion>() }))).toBe(true)
    expect(isFilterActive(criteria({ excludedLangs: new Set(['en']) }))).toBe(true)
    expect(isFilterActive(criteria({ signalFilter: { ...emptySignalFilter(), majorOnly: true } }))).toBe(true)
  })
})

describe('filterArticles', () => {
  it('passes everything through with the default criteria, preserving order', () => {
    const list = [art(), art({ source_region: 'Russian', source_lang: 'ru' }), art({ summary: 's' })]
    expect(filterArticles(list, criteria())).toEqual(list)
  })

  it('filters by region', () => {
    const us = art()
    const ru = art({ source_region: 'Russian' })
    expect(filterArticles([us, ru], criteria({ activeRegions: new Set<SourceRegion>(['Russian']) }))).toEqual([ru])
    expect(filterArticles([us, ru], criteria({ activeRegions: new Set<SourceRegion>() }))).toEqual([])
  })

  it('treats languages as an exclusion set, so an unseen language shows by default', () => {
    const en = art()
    const fa = art({ source_lang: 'fa' })
    expect(filterArticles([en, fa], criteria({ excludedLangs: new Set(['en']) }))).toEqual([fa])
    expect(filterArticles([en, fa], criteria({ excludedLangs: new Set(['de']) }))).toEqual([en, fa])
  })

  it('searches title and summary, case-insensitively, ignoring surrounding whitespace', () => {
    const inTitle = art({ title: 'Ceasefire talks resume' })
    const inSummary = art({ title: 'Other', summary: 'A CEASEFIRE was discussed' })
    const nullSummary = art({ title: 'Unrelated', summary: null })
    const list = [inTitle, inSummary, nullSummary]
    expect(filterArticles(list, criteria({ searchQuery: '  ceaseFIRE ' }))).toEqual([inTitle, inSummary])
    expect(filterArticles(list, criteria({ searchQuery: 'zzz-no-such-headline-zzz' }))).toEqual([])
  })

  it('applies the signal filter; unannotated articles pass hides and fail narrowing', () => {
    const major = art({ severity: 0.9 })
    const opinion = art({ severity: 0.9, opinion: 0.95 })
    const bare = art()
    const list = [major, opinion, bare]
    expect(filterArticles(list, criteria({ signalFilter: { ...emptySignalFilter(), majorOnly: true } }))).toEqual([major, opinion])
    expect(filterArticles(list, criteria({ signalFilter: { ...emptySignalFilter(), hideOpinion: true } }))).toEqual([major, bare])
  })

  it('requires region AND language AND search AND signals together', () => {
    const topic = ALL_TOPICS[0]
    const hit = art({ title: 'Strike on depot', source_region: 'Ukrainian', source_lang: 'uk', severity: 0.9, topic })
    const list = [
      hit,
      art({ title: 'Strike on depot', source_region: 'Russian', source_lang: 'uk', severity: 0.9, topic }), // wrong region
      art({ title: 'Strike on depot', source_region: 'Ukrainian', source_lang: 'en', severity: 0.9, topic }), // excluded lang
      art({ title: 'Grain deal', source_region: 'Ukrainian', source_lang: 'uk', severity: 0.9, topic }), // no search match
      art({ title: 'Strike on depot', source_region: 'Ukrainian', source_lang: 'uk', severity: 0.1, topic }), // not major
      art({ title: 'Strike on depot', source_region: 'Ukrainian', source_lang: 'uk', severity: 0.9 }), // no topic
    ]
    const f = criteria({
      searchQuery: 'strike',
      activeRegions: new Set<SourceRegion>(['Ukrainian', 'UK']),
      excludedLangs: new Set(['en']),
      signalFilter: { ...emptySignalFilter(), majorOnly: true, topics: new Set([topic]) },
    })
    expect(filterArticles(list, f)).toEqual([hit])
  })

  it('returns an empty list for empty input', () => {
    expect(filterArticles([], criteria())).toEqual([])
    expect(filterArticles([], criteria({ searchQuery: 'x' }))).toEqual([])
  })
})

describe('chip counters', () => {
  it('countLangs: most common first', () => {
    const list = [art({ source_lang: 'ru' }), art(), art(), art({ source_lang: 'fa' }), art({ source_lang: 'ru' }), art()]
    expect(countLangs(list)).toEqual([
      { lang: 'en', count: 3 },
      { lang: 'ru', count: 2 },
      { lang: 'fa', count: 1 },
    ])
    expect(countLangs([])).toEqual([])
  })

  it('countTopics: only topics present, in canonical ALL_TOPICS order', () => {
    const [t0, t1] = ALL_TOPICS
    const list = [art({ topic: t1 }), art({ topic: t1 }), art({ topic: t0 }), art(), art({ topic: null })]
    expect(countTopics(list)).toEqual([
      { key: t0, count: 1 },
      { key: t1, count: 2 },
    ])
    expect(countTopics([])).toEqual([])
  })

  it('countActors: counts every actor on every article, most common first', () => {
    const list = [
      art({ actors: ['russia', 'ukraine'] as Article['actors'] }),
      art({ actors: ['russia'] as Article['actors'] }),
      art({ actors: null }),
      art(),
    ]
    expect(countActors(list)).toEqual([
      { key: 'russia', count: 2 },
      { key: 'ukraine', count: 1 },
    ])
    expect(countActors([])).toEqual([])
  })
})
