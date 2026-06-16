import { describe, it, expect } from 'vitest'
import { groupByStoryId } from './cluster'
import type { Article } from './types'

let seq = 0
function article(overrides: Partial<Article> = {}): Article {
  seq++
  return {
    id: `a-${seq}`,
    guid: `guid-${seq}`,
    title: `Article ${seq}`,
    url: `https://example.com/${seq}`,
    summary: null,
    published_at: '2026-06-10T12:00:00Z',
    fetched_at: '2026-06-10T12:01:00Z',
    source_name: `Source ${seq}`,
    source_region: 'US/Western',
    source_lang: 'en',
    source_affiliation: null,
    feed_url: 'https://example.com/feed',
    source_id: null,
    body_hash: null,
    story_id: null,
    cluster_id: null,
    ...overrides,
  }
}

describe('groupByStoryId', () => {
  it('groups members of the same story together', () => {
    const a = article({ story_id: 's-1' })
    const b = article({ story_id: 's-1' })
    const c = article({ story_id: 's-2' })
    const clusters = groupByStoryId([a, b, c])
    expect(clusters).toHaveLength(2)
    const s1 = clusters.find((cl) => cl.id === 's-1')!
    expect(s1.articles).toHaveLength(2)
    expect(s1.storyId).toBe('s-1')
  })

  it('renders unassigned articles (null OR undefined story_id) as singletons', () => {
    const assigned = article({ story_id: 's-1' })
    const nullArticle = article({ story_id: null })
    // SW-cached pre-stories rows lack the column entirely.
    const undefinedArticle = article()
    delete (undefinedArticle as Partial<Article>).story_id
    const clusters = groupByStoryId([assigned, nullArticle, undefinedArticle])
    expect(clusters).toHaveLength(3)
    const singleton = clusters.find((cl) => cl.id === nullArticle.id)!
    expect(singleton.storyId).toBeNull()
    expect(singleton.articles).toEqual([nullArticle])
  })

  it('picks the newest member as representative and keeps it at articles[0]', () => {
    const older = article({ story_id: 's-1', published_at: '2026-06-10T08:00:00Z' })
    const newest = article({ story_id: 's-1', published_at: '2026-06-10T14:00:00Z' })
    const middle = article({ story_id: 's-1', published_at: '2026-06-10T11:00:00Z' })
    const [cluster] = groupByStoryId([older, newest, middle])
    expect(cluster.representative).toBe(newest)
    expect(cluster.articles[0]).toBe(newest)
    expect(cluster.articles).toHaveLength(3)
  })

  it('treats null published_at as oldest when picking the representative', () => {
    const dated = article({ story_id: 's-1', published_at: '2026-06-10T08:00:00Z' })
    const undated = article({ story_id: 's-1', published_at: null })
    const [cluster] = groupByStoryId([undated, dated])
    expect(cluster.representative).toBe(dated)
  })

  it('counts distinct outlets, not articles', () => {
    const a = article({ story_id: 's-1', source_name: 'Reuters' })
    const b = article({ story_id: 's-1', source_name: 'Reuters' })
    const c = article({ story_id: 's-1', source_name: 'TASS' })
    const [cluster] = groupByStoryId([a, b, c])
    expect(cluster.sourceCount).toBe(2)
  })

  it('sorts clusters by representative published_at DESC with nulls last', () => {
    const newest = article({ story_id: 's-new', published_at: '2026-06-10T15:00:00Z' })
    const oldest = article({ story_id: 's-old', published_at: '2026-06-10T01:00:00Z' })
    const undated = article({ story_id: 's-undated', published_at: null })
    const clusters = groupByStoryId([oldest, undated, newest])
    expect(clusters.map((c) => c.id)).toEqual(['s-new', 's-old', 's-undated'])
  })
})
