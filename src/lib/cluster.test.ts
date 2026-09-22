import { describe, it, expect } from 'vitest'
import { groupByStoryId, storyTimeline, storyImage, isShareCard, isReusedUpload } from './cluster'
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

describe('storyTimeline', () => {
  it('orders members oldest → newest with undated last', () => {
    const undated = article({ published_at: null })
    const newest = article({ published_at: '2026-06-10T14:00:00Z' })
    const oldest = article({ published_at: '2026-06-10T08:00:00Z' })
    const { ordered } = storyTimeline([undated, newest, oldest])
    expect(ordered.map((e) => e.article)).toEqual([oldest, newest, undated])
  })

  it('tags the earliest member as FIRST and computes offsets from it', () => {
    const first = article({ published_at: '2026-06-10T08:00:00Z' })
    const later = article({ published_at: '2026-06-10T08:30:00Z' })
    const tl = storyTimeline([later, first])
    expect(tl.firstAt).toBe(Date.parse('2026-06-10T08:00:00Z'))
    expect(tl.ordered[0].isFirst).toBe(true)
    expect(tl.ordered[0].offsetMs).toBe(0)
    expect(tl.ordered[1].isFirst).toBe(false)
    expect(tl.ordered[1].offsetMs).toBe(30 * 60 * 1000)
  })

  it('skips a wire reprint when choosing FIRST and flags later copies as wire', () => {
    // Earliest-published copy is a syndicated wire reprint (shares body_hash);
    // the original report is the next-earliest distinct-body member.
    const wireOrigin = article({ published_at: '2026-06-10T08:00:00Z', body_hash: 'h1', source_name: 'WireA' })
    const wireCopy = article({ published_at: '2026-06-10T09:00:00Z', body_hash: 'h1', source_name: 'WireB' })
    const original = article({ published_at: '2026-06-10T08:30:00Z', body_hash: 'h2', source_name: 'Original' })
    const tl = storyTimeline([wireCopy, wireOrigin, original])
    // wireOrigin is the earliest in its hash group, so it's the origin (NOT
    // badged) and remains eligible to be FIRST; only the later wireCopy is badged.
    const byId = Object.fromEntries(tl.ordered.map((e) => [e.article.id, e]))
    expect(byId[wireCopy.id].isWire).toBe(true)
    expect(byId[wireOrigin.id].isWire).toBe(false)
    expect(tl.ordered.find((e) => e.isFirst)!.article).toBe(wireOrigin)
  })

  it('counts distinct sources and regions', () => {
    const a = article({ story_id: 's', source_name: 'Reuters', source_region: 'US/Western' })
    const b = article({ story_id: 's', source_name: 'Reuters', source_region: 'US/Western' })
    const c = article({ story_id: 's', source_name: 'TASS', source_region: 'Russian' })
    const tl = storyTimeline([a, b, c])
    expect(tl.sourceCount).toBe(2)
    expect(tl.regionCount).toBe(2)
  })

  it('returns null firstAt/offsets when no member has a date', () => {
    const tl = storyTimeline([article({ published_at: null }), article({ published_at: null })])
    expect(tl.firstAt).toBeNull()
    expect(tl.ordered.every((e) => e.offsetMs === null)).toBe(true)
    expect(tl.ordered.some((e) => e.isFirst)).toBe(false)
  })
})

describe('storyImage', () => {
  it('returns null when no member has a photograph', () => {
    const [cluster] = groupByStoryId([article({ story_id: 's' }), article({ story_id: 's' })])
    expect(storyImage(cluster)).toBeNull()
  })

  it('uses the representative\'s photo when it has one', () => {
    const older = article({
      story_id: 's',
      published_at: '2026-06-10T08:00:00Z',
      source_name: 'TASS',
      image_url: 'https://cdn.example/tass.jpg',
      image_width: 1600,
      image_height: 900,
    })
    const newest = article({
      story_id: 's',
      published_at: '2026-06-10T14:00:00Z',
      source_name: 'Reuters',
      image_url: 'https://cdn.example/reuters.jpg',
      image_width: 400,
      image_height: 300,
    })
    const [cluster] = groupByStoryId([older, newest])
    const photo = storyImage(cluster)!
    expect(photo.url).toBe('https://cdn.example/reuters.jpg')
    expect(photo.sourceName).toBe('Reuters')
  })

  it('falls back to the largest photo from another member', () => {
    const newest = article({
      story_id: 's',
      published_at: '2026-06-10T14:00:00Z',
      source_name: 'Reuters',
    })
    const small = article({
      story_id: 's',
      published_at: '2026-06-10T10:00:00Z',
      source_name: 'AP',
      image_url: 'https://cdn.example/ap.jpg',
      image_width: 400,
      image_height: 300,
    })
    const large = article({
      story_id: 's',
      published_at: '2026-06-10T09:00:00Z',
      source_name: 'TASS',
      image_url: 'https://cdn.example/tass.jpg',
      image_width: 1600,
      image_height: 900,
    })
    const [cluster] = groupByStoryId([newest, small, large])
    const photo = storyImage(cluster)!
    expect(photo.url).toBe('https://cdn.example/tass.jpg')
    expect(photo.sourceName).toBe('TASS')
  })
})

describe('isShareCard', () => {
  it('matches the same share-card URLs ingest rejects', () => {
    expect(isShareCard('https://cdnn21.img.ria.ru/images/sharing/article/2119610738.jpg?21186970631790101859')).toBe(true)
    expect(isShareCard('https://meduza.io/imgly/share/1790102657/en/news/2026/09/22/some-story')).toBe(true)
    expect(isShareCard('https://cdnn21.img.ria.ru/images/07ea/09/15/2119148103_0:267:3166:2048_650x0_80.jpg')).toBe(false)
    expect(isShareCard('https://news.example/photos/shareholders-meeting.jpg')).toBe(false)
  })

  it('a story whose only photo is a share card shows none', () => {
    const [cluster] = groupByStoryId([article({ image_url: 'https://cdnn21.img.ria.ru/images/sharing/article/1.jpg' })])
    expect(storyImage(cluster)).toBeNull()
  })
})

describe('share-card pattern', () => {
  it('matches ingest exactly, so display and pipeline never disagree', async () => {
    const { readFileSync } = await import('node:fs')
    const grab = (path: string) => readFileSync(path, 'utf8').match(/const SHARE_CARD =\s*(\/.*\/i)/)?.[1]
    const display = grab('src/lib/cluster.ts')
    expect(display).toBeTruthy()
    expect(display).toBe(grab('src/lib/server/image.ts'))
  })
})

describe('isReusedUpload', () => {
  const at = '2026-09-22T15:00:00Z'
  it('flags a WordPress upload far older than the article', () => {
    expect(isReusedUpload('https://www.alquds.co.uk/wp-content/uploads/2024/08/br-20082024.jpg', at)).toBe(true)
  })
  it('keeps this month, last month and anything without a dated path', () => {
    expect(isReusedUpload('https://www.alquds.co.uk/wp-content/uploads/2026/09/Yemen-5.jpg', at)).toBe(false)
    expect(isReusedUpload('https://www.aljazeera.com/wp-content/uploads/2026/08/image.jpg', at)).toBe(false)
    expect(isReusedUpload('https://cdn.isna.ir/d/2020/01/01/4/1.jpg', at)).toBe(false)
    expect(isReusedUpload('https://www.alquds.co.uk/wp-content/uploads/2024/08/x.jpg', null)).toBe(false)
  })
  it('a story whose only photo is a reused template shows none', () => {
    const [cluster] = groupByStoryId([article({ published_at: at, image_url: 'https://www.alquds.co.uk/wp-content/uploads/2024/08/br-20082024.jpg' })])
    expect(storyImage(cluster)).toBeNull()
  })
})
