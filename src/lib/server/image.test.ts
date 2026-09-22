import { describe, it, expect } from 'vitest'
import {
  sanitizeImageUrl,
  pickBestImage,
  pickFeedImage,
  extractPageImage,
  dropChannelLogos,
  acceptable,
} from './image'

const BASE = 'https://news.example/story'

describe('sanitizeImageUrl', () => {
  it('resolves relative URLs against the article', () => {
    expect(sanitizeImageUrl('/photo.jpg', BASE)).toBe('https://news.example/photo.jpg')
  })

  it('rejects javascript, data, credentials, trackers and audio', () => {
    expect(sanitizeImageUrl('javascript:alert(1)', BASE)).toBeNull()
    expect(sanitizeImageUrl('data:image/png;base64,xx', BASE)).toBeNull()
    expect(sanitizeImageUrl('https://user:pass@cdn.example/a.jpg', BASE)).toBeNull()
    expect(sanitizeImageUrl('https://example.com/pixel.gif', BASE)).toBeNull()
    expect(sanitizeImageUrl('https://cdn.example/audio.mp3', BASE)).toBeNull()
  })
})

describe('pickBestImage', () => {
  it('drops tiny images and prefers the largest remaining', () => {
    expect(acceptable({ url: 'https://x/a.jpg', width: 80, height: 80 })).toBe(false)
    const best = pickBestImage([
      { url: 'https://x/small.jpg', width: 400, height: 300 },
      { url: 'https://x/hero.jpg', width: 1200, height: 800 },
    ])
    expect(best?.url).toBe('https://x/hero.jpg')
  })
})

describe('pickFeedImage', () => {
  it('reads rss-parser media:content ($ attrs) and prefers it over a thumbnail', () => {
    const img = pickFeedImage(
      {
        mediaContent: [
          { $: { url: 'https://cdn.example/hero.jpg', medium: 'image', width: '1200', height: '800' } },
        ],
        mediaThumbnail: [{ $: { url: 'https://cdn.example/thumb.jpg', width: '120', height: '80' } }],
      },
      BASE,
    )
    expect(img).toEqual({ url: 'https://cdn.example/hero.jpg', width: 1200, height: 800 })
  })

  it('reads the lenient parser\'s @_ attrs and enclosure', () => {
    expect(
      pickFeedImage(
        { 'media:content': { '@_url': 'https://cdn.example/a.jpg', '@_medium': 'image', '@_width': '800', '@_height': '450' } },
        BASE,
      )?.url,
    ).toBe('https://cdn.example/a.jpg')
    expect(
      pickFeedImage({ enclosure: { url: 'https://cdn.example/b.jpg', type: 'image/jpeg' } }, BASE)?.url,
    ).toBe('https://cdn.example/b.jpg')
  })

  it('skips video enclosures and pulls an <img> out of the description', () => {
    expect(pickFeedImage({ enclosure: { url: 'https://cdn.example/clip.mp4', type: 'video/mp4' } }, BASE)).toBeNull()
    expect(
      pickFeedImage(
        { description: '<p>Lead</p><img src="https://cdn.example/from-html.jpg" width="640">' },
        BASE,
      )?.url,
    ).toBe('https://cdn.example/from-html.jpg')
  })
})

describe('extractPageImage', () => {
  it('prefers og:image, with width/height when present', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example/og.jpg">
      <meta property="og:image:width" content="1200">
      <meta property="og:image:height" content="630">
      <meta name="twitter:image" content="https://cdn.example/tw.jpg">
    </head></html>`
    expect(extractPageImage(html, BASE)).toEqual({
      url: 'https://cdn.example/og.jpg',
      width: 1200,
      height: 630,
    })
  })

  it('falls back to NewsArticle JSON-LD image objects', () => {
    const ld = JSON.stringify({
      '@type': 'NewsArticle',
      image: { '@type': 'ImageObject', url: 'https://cdn.example/ld.jpg', width: 1600, height: 900 },
    })
    const html = `<script type="application/ld+json">${ld}</script>`
    expect(extractPageImage(html, BASE)?.url).toBe('https://cdn.example/ld.jpg')
  })

  it('returns null when the page has no photograph', () => {
    expect(extractPageImage('<html><head><title>Talks</title></head></html>', BASE)).toBeNull()
  })
})

describe('dropChannelLogos', () => {
  it('clears an image that is on every item of a feed (channel logo)', () => {
    const logo = 'https://cdn.example/masthead.png'
    const items = [
      { image_url: logo, image_width: 400, image_height: 400, image_fetched_at: 't' },
      { image_url: logo, image_width: 400, image_height: 400, image_fetched_at: 't' },
      { image_url: logo, image_width: 400, image_height: 400, image_fetched_at: 't' },
    ]
    dropChannelLogos(items)
    expect(items.every((a) => a.image_url === null && a.image_fetched_at === null)).toBe(true)
  })

  it('keeps a photo that only some items share', () => {
    const items = [
      { image_url: 'https://cdn.example/a.jpg' },
      { image_url: 'https://cdn.example/a.jpg' },
      { image_url: 'https://cdn.example/b.jpg' },
    ]
    dropChannelLogos(items)
    expect(items.map((a) => a.image_url)).toEqual([
      'https://cdn.example/a.jpg',
      'https://cdn.example/a.jpg',
      'https://cdn.example/b.jpg',
    ])
  })
})
