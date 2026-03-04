import { describe, it, expect } from 'vitest'
import { clusterArticles } from './cluster'
import type { Article } from './types'

function makeArticle(id: string, title: string, published_at?: string | null): Article {
  return {
    id,
    guid: id,
    title,
    url: `https://example.com/${id}`,
    summary: null,
    published_at: published_at !== undefined ? published_at : new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_name: 'Test Source',
    source_region: 'US/Western',
    cluster_id: null,
    source_lang: 'en',
    feed_url: 'https://example.com/rss',
  }
}

describe('clusterArticles', () => {
  it('wraps a single article in a single cluster', () => {
    const articles = [makeArticle('1', 'Iran launches missile strike on Israel')]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sourceCount).toBe(1)
    expect(clusters[0].representative.id).toBe('1')
  })

  it('clusters two articles with similar titles', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', now),
      makeArticle('2', 'Iran launches missile strike targeting Israel', now),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sourceCount).toBe(2)
  })

  it('does not cluster articles with unrelated titles', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', now),
      makeArticle('2', 'Lebanon arrests foreign nationals collaboration', now),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(2)
  })

  it('does not cluster articles outside the 8-hour window', () => {
    const now = Date.now()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', new Date(now).toISOString()),
      makeArticle('2', 'Iran launches missile strike on Israel', new Date(now - 9 * 60 * 60 * 1000).toISOString()),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(2)
  })

  it('uses the first article as the cluster representative', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', now),
      makeArticle('2', 'Iran launches missiles strike on Israel', now),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters[0].representative.id).toBe('1')
  })

  it('handles articles with null published_at without throwing', () => {
    const articles = [
      makeArticle('1', 'Iran strikes Israel', null),
      makeArticle('2', 'Iran strikes Israel again', null),
    ]
    expect(() => clusterArticles(articles)).not.toThrow()
  })

  it('clusters three articles about the same event', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Israel bombs Iranian nuclear facility Natanz', now),
      makeArticle('2', 'Israel bombs nuclear facility Natanz Iran', now),
      makeArticle('3', 'Israeli strike bombs nuclear facility Natanz', now),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sourceCount).toBe(3)
  })
})
