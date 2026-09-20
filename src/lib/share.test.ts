import { describe, expect, it } from 'vitest'
import { shareTarget } from './share'

describe('share links', () => {
  const article = { id: 'article-id', title: 'Talks &amp; statements &#8212; update' }
  it('uses a durable story link for multiple sources and decodes the original title', () => {
    expect(shareTarget(article, { storyId: 'story-id', sourceCount: 3 })).toEqual({
      kind: 'story', url: 'https://ww3watch.org/?story=story-id', title: 'Talks & statements — update',
    })
  })
  it('uses the selected article for single-source and unassigned coverage', () => {
    for (const cluster of [null, { storyId: 'story-id', sourceCount: 1 }, { storyId: null, sourceCount: 3 }]) {
      expect(shareTarget(article, cluster).url).toBe('https://ww3watch.org/?article=article-id')
    }
  })
})
