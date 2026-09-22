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

  it('rejects social share cards that print the headline onto the image', () => {
    for (const url of [
      'https://cdnn21.img.ria.ru/images/sharing/article/2119610738.jpg?211869',
      'https://meduza.io/imgly/share/1790102657/en/news/2026/09/22/some-story',
      'https://news.example/api/og?title=Hello',
      'https://news.example/og-image.png',
      'https://news.example/opengraph-image/123',
      'https://news.example/media/social-card/1.jpg',
      'https://tass.com/img/blocks/common/tass_logo_share_eng.png',
      'https://r.yna.co.kr/global/home/v01/img/yonhapnews_logo_1200x800_en01.jpg',
    ]) expect(sanitizeImageUrl(url, BASE), url).toBeNull()
    // Ordinary photos, including ones whose names merely contain the words.
    for (const url of [
      'https://cdnn21.img.ria.ru/images/07ea/09/15/2119148103_0:267:3166:2048_650x0_80.jpg',
      'https://cdn-media.tass.ru/width/1200_4ce85301/tass/m2/en/uploads/i/20260922/1487605.jpg',
      'https://news.example/photos/shareholders-meeting.jpg',
      'https://news.example/photos/catalogo-2026.jpg',
    ]) expect(sanitizeImageUrl(url, BASE), url).toBe(url)
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
