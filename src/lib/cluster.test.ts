import { describe, it, expect } from 'vitest'
import { clusterArticles } from './cluster'
import type { Article } from './types'

function makeArticle(
  id: string,
  title: string,
  published_at?: string | null,
  source_name = 'Test Source',
): Article {
  return {
    id,
    guid: id,
    title,
    url: `https://example.com/${id}`,
    summary: null,
    published_at: published_at !== undefined ? published_at : new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    source_name,
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

  it('clusters two articles with similar titles (distinct sources)', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', now, 'Reuters'),
      makeArticle('2', 'Iran launches missile strike targeting Israel', now, 'AP'),
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

  it('does not over-merge a short headline contained in an unrelated longer one', () => {
    // Regression: the old overlap coefficient scored "Russia Ukraine" vs the
    // longer headline at 1.0 (both tokens are a subset) and merged them. True
    // Jaccard scores 2/8 = 0.25 < threshold, so they stay separate.
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Russia Ukraine', now),
      makeArticle('2', 'Russia and Ukraine sign grain export logistics framework agreement', now),
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

  it('counts distinct outlets, not article count, in sourceCount', () => {
    // Two articles from the SAME outlet covering the same story → 1 source.
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Iran launches missile strike on Israel', now, 'Reuters'),
      makeArticle('2', 'Iran launches missile strike targeting Israel', now, 'Reuters'),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sourceCount).toBe(1)
  })

  it('handles articles with null published_at without throwing', () => {
    const articles = [
      makeArticle('1', 'Iran strikes Israel', null),
      makeArticle('2', 'Iran strikes Israel again', null),
    ]
    expect(() => clusterArticles(articles)).not.toThrow()
  })

  it('clusters three articles about the same event (distinct sources)', () => {
    const now = new Date().toISOString()
    const articles = [
      makeArticle('1', 'Israel bombs Iranian nuclear facility Natanz', now, 'Reuters'),
      makeArticle('2', 'Israel bombs nuclear facility Natanz Iran', now, 'AP'),
      makeArticle('3', 'Israeli strike bombs nuclear facility Natanz', now, 'BBC'),
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].sourceCount).toBe(3)
  })
})
