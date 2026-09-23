import { describe, it, expect } from 'vitest'
import { shareCard, type CardRow } from './share-card'

const row = (o: Partial<CardRow> & { id: string }): CardRow => ({
  title: 'Headline', source_name: 'Reuters', source_lang: 'en', published_at: '2026-09-22T10:00:00Z',
  story_id: 's1', image_url: null, image_width: null, image_height: null, ...o,
})

describe('shareCard', () => {
  it('names the story, its source count and the publisher photo', () => {
    const card = shareCard('story', 's1', null, [
      row({ id: 'a', title: 'Older &amp; English', source_name: 'BBC', published_at: '2026-09-22T09:00:00Z',
        image_url: 'https://bbc.example/photo.jpg',
        image_verdict: 'photo', image_width: 1200, image_height: 800 }),
      row({ id: 'b', title: 'Newest', source_name: 'Reuters' }),
      row({ id: 'c', title: 'Also', source_name: 'TASS', source_lang: 'ru', published_at: '2026-09-22T08:00:00Z' }),
    ])!
    expect(card.title).toBe('Newest')
    expect(card.url).toBe('https://ww3watch.org/?story=s1')
    expect(card.description).toBe('3 sources, including Reuters, BBC, TASS. Compare the coverage on WW3Watch.')
    expect(card.image).toEqual({ url: 'https://bbc.example/photo.jpg', width: 1200, height: 800, alt: 'Photograph published by BBC' })
  })

  it('prefers an English headline for a story led by another language', () => {
    const card = shareCard('story', 's1', null, [
      row({ id: 'a', title: 'Заголовок', source_lang: 'ru', source_name: 'TASS' }),
      row({ id: 'b', title: 'Headline &amp; more', published_at: '2026-09-22T07:00:00Z' }),
    ])!
    expect(card.title).toBe('Headline & more')
  })

  it('keeps a shared article\'s own headline and photo', () => {
    const target = row({ id: 't', title: 'Mine', source_name: 'AP', image_url: 'https://ap.example/p.jpg', image_verdict: 'photo', published_at: '2026-09-22T01:00:00Z' })
    const card = shareCard('article', 't', target, [row({ id: 'n', image_url: 'https://r.example/n.jpg', image_verdict: 'photo' }), target])!
    expect(card.title).toBe('Mine')
    expect(card.image?.url).toBe('https://ap.example/p.jpg')
    expect(card.url).toBe('https://ww3watch.org/?article=t')
    expect(card.description).toMatch(/^2 sources, including AP, Reuters\./)
  })

  it('never uses a share card or logo as the photo', () => {
    const card = shareCard('article', 't', row({ id: 't', image_url: 'https://ria.example/images/sharing/article/1.jpg', image_verdict: 'photo' }), [])!
    expect(card.image).toBeNull()
    expect(card.description).toBe('Reported by Reuters. Read it on WW3Watch.')
  })

  it('returns null when nothing was found', () => {
    expect(shareCard('story', 'gone', null, [])).toBeNull()
  })
})
