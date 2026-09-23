import { describe, it, expect } from 'vitest'
import type { Article } from './types'
import { searchArticles } from './search.svelte'

let n = 0
function art(o: Partial<Article> = {}): Article {
  n++
  return {
    id: `a${n}`, title: `t${n}`, url: `https://x/${n}`, summary: null,
    published_at: null, fetched_at: null,
    source_name: `S${n}`, source_region: 'US/Western', source_lang: 'en',
    source_affiliation: null, body_hash: null, story_id: null,
    ...o,
  } as Article
}

describe('searchArticles', () => {
  it('passes everything through for an empty or whitespace-only query, preserving order', () => {
    const list = [art(), art({ source_region: 'Russian', source_lang: 'ru' }), art({ summary: 's' })]
    expect(searchArticles(list, '')).toEqual(list)
    expect(searchArticles(list, '   ')).toEqual(list)
  })

  it('searches title and summary, case-insensitively, ignoring surrounding whitespace', () => {
    const inTitle = art({ title: 'Ceasefire talks resume' })
    const inSummary = art({ title: 'Other', summary: 'A CEASEFIRE was discussed' })
    const nullSummary = art({ title: 'Unrelated', summary: null })
    const list = [inTitle, inSummary, nullSummary]
    expect(searchArticles(list, '  ceaseFIRE ')).toEqual([inTitle, inSummary])
    expect(searchArticles(list, 'zzz-no-such-headline-zzz')).toEqual([])
  })

  it('returns an empty list for empty input', () => {
    expect(searchArticles([], '')).toEqual([])
    expect(searchArticles([], 'x')).toEqual([])
  })
})
