import { describe, it, expect } from 'vitest'
import { groupByStoryId } from './cluster'
import { theaterOf, theaterBoard, theaterById } from './theaters'
import type { Article } from './types'
import type { Actor } from './signals'

let seq = 0
function article(actors: Actor[] | null, overrides: Partial<Article> = {}): Article {
  seq++
  return {
    id: `a-${seq}`,
    title: `Article ${seq}`,
    url: `https://example.com/${seq}`,
    summary: null,
    published_at: '2026-06-10T12:00:00Z',
    fetched_at: '2026-06-10T12:01:00Z',
    source_name: `Source ${seq}`,
    source_region: 'US/Western',
    source_lang: 'en',
    source_affiliation: null,
    body_hash: null,
    story_id: null,
    actors,
    ...overrides,
  }
}
const story = (...articles: Article[]) => groupByStoryId(articles)[0]
const place = (...actors: Actor[][]) => theaterOf(story(...actors.map((a) => article(a, { story_id: 's' }))))?.id ?? null

describe('theaterOf', () => {
  it('places a story by the actors its articles name', () => {
    expect(place(['ukraine', 'russia'])).toBe('ukraine')
    expect(place(['koreas'])).toBe('koreas')
    expect(place(['palestine', 'israel'])).toBe('israel-gaza')
  })

  it('lets the place outvote the powers that appear everywhere', () => {
    expect(place(['israel', 'lebanon'])).toBe('lebanon-syria')
    expect(place(['russia', 'europe_nato'])).toBe('europe-nato')
    expect(place(['iran', 'israel'])).toBe('iran-gulf')
  })

  it('breaks a tie toward the narrower theater', () => {
    expect(place(['yemen', 'gulf'])).toBe('red-sea')
  })

  it('counts every outlet in the story, not just the lead', () => {
    expect(place(['china'], ['taiwan'], ['koreas'])).toBe('china-taiwan')
  })

  it('leaves a story with no place, or only the United States, unplaced', () => {
    expect(place(['us'])).toBeNull()
    expect(theaterOf(story(article(null)))).toBeNull()
  })
})

describe('theaterBoard', () => {
  const now = Date.parse('2026-06-10T13:00:00Z')
  const old = '2026-06-08T12:00:00Z'

  it('lists busiest first, counts the last day and its major stories, and leads with the widest coverage', () => {
    const clusters = groupByStoryId([
      article(['ukraine'], { story_id: 'u1', severity: 0.8 }),
      article(['ukraine'], { story_id: 'u2' }),
      article(['ukraine'], { story_id: 'u2' }),
      article(['ukraine'], { story_id: 'u3', published_at: old }),
      article(['koreas'], { story_id: 'k1' }),
      article(['us'], { story_id: 'x' }),
    ])
    const board = theaterBoard(clusters, now)
    expect(board.map((b) => b.theater.id)).toEqual(['ukraine', 'koreas'])
    expect(board[0]).toMatchObject({ today: 2, major: 1 })
    expect(board[0].stories).toHaveLength(3)
    expect(board[0].lead.id).toBe('u2')
  })

  it('still leads a quiet theater with its newest story', () => {
    const board = theaterBoard(groupByStoryId([article(['africa'], { story_id: 'a1', published_at: old })]), now)
    expect(board[0]).toMatchObject({ today: 0, major: 0 })
    expect(board[0].lead.id).toBe('a1')
  })
})

describe('theaterById', () => {
  it('finds a theater, and nothing for an unknown id', () => {
    expect(theaterById('koreas')?.label).toBe('Korean Peninsula')
    expect(theaterById('atlantis')).toBeNull()
    expect(theaterById(null)).toBeNull()
  })
})

describe('theaterBoard lead', () => {
  it('prefers a story an English-language outlet reported when coverage is equal', () => {
    const now = Date.parse('2026-06-10T13:00:00Z')
    const board = theaterBoard(groupByStoryId([
      article(['ukraine'], { story_id: 'fa', source_lang: 'fa', published_at: '2026-06-10T12:30:00Z' }),
      article(['ukraine'], { story_id: 'en' }),
    ]), now)
    expect(board[0].lead.id).toBe('en')
  })
})
