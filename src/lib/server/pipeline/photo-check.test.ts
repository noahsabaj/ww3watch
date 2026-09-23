import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

type Row = { id: string; story_id: string | null; image_url: string | null; published_at: string; image_verdict: string | null; image_hash: string | null }
const db = vi.hoisted(() => ({ rows: [] as Row[] }))

// A tiny in-memory articles table: just the filters the stage uses.
vi.mock('../supabase', () => {
  function query(rows: () => Row[]) {
    const filters: Array<(r: Row) => boolean> = []
    let patch: Partial<Row> | null = null
    let limit = Infinity
    const q = {
      select: () => q,
      update: (p: Partial<Row>) => { patch = p; return q },
      not: (col: keyof Row, _op: string, _v: null) => { filters.push((r) => r[col] !== null); return q },
      is: (col: keyof Row, _v: null) => { filters.push((r) => r[col] === null); return q },
      gte: (col: keyof Row, v: string) => { filters.push((r) => String(r[col]) >= v); return q },
      eq: (col: keyof Row, v: unknown) => { filters.push((r) => r[col] === v); return q },
      in: (col: keyof Row, vs: unknown[]) => { filters.push((r) => vs.includes(r[col])); return q },
      order: () => q,
      limit: (n: number) => { limit = n; return q },
      then(resolve: (v: { data: Row[] | null; error: null }) => void) {
        const hit = rows().filter((r) => filters.every((f) => f(r))).slice(0, limit)
        if (patch) for (const r of hit) Object.assign(r, patch)
        resolve({ data: patch ? null : hit.map((r) => ({ ...r })), error: null })
      },
    }
    return q
  }
  return { supabaseAdmin: { from: () => query(() => db.rows) } }
})

import { checkPhotos, differenceHash, judgeImage, EMBLEM_MIN, REUSE_MIN } from './photo-check'
import type { RunStats } from './stats'

const now = new Date().toISOString()
const row = (id: string, story: string | null, url: string | null): Row =>
  ({ id, story_id: story, image_url: url, published_at: now, image_verdict: null, image_hash: null })

// Distinct pictures: a gradient in a different direction or colour each.
async function picture(seed: number): Promise<Buffer> {
  const w = 64, h = 40
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3
    px[i] = (x * 4 * (seed % 3 + 1)) & 255
    px[i + 1] = (y * 6 * (seed % 5 + 1)) & 255
    px[i + 2] = ((x + y) * seed * 7) & 255
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer()
}

let pictures: Record<string, Buffer>
const fetchPicture = async (url: string) => pictures[url] ?? null
const scorer = async (image: Buffer) => (image.equals(pictures['emblem.jpg']) ? 0.99 : 0.1)

beforeEach(async () => {
  db.rows = []
  pictures = { 'a.jpg': await picture(1), 'b.jpg': await picture(2), 'card.jpg': await picture(3), 'emblem.jpg': await picture(4) }
})

describe('judgeImage', () => {
  it('calls an image an emblem only at or above EMBLEM_MIN', async () => {
    const img = pictures['a.jpg']
    expect((await judgeImage(img, async () => EMBLEM_MIN)).verdict).toBe('emblem')
    expect((await judgeImage(img, async () => EMBLEM_MIN - 0.01)).verdict).toBe('photo')
  })

  it('hashes the same picture the same at any size, and different pictures differently', async () => {
    const big = await sharp(pictures['a.jpg']).resize(640, 400).jpeg({ quality: 60 }).toBuffer()
    expect(await differenceHash(big)).toBe(await differenceHash(pictures['a.jpg']))
    expect(await differenceHash(pictures['b.jpg'])).not.toBe(await differenceHash(pictures['a.jpg']))
  })
})

describe('checkPhotos', () => {
  const run = (stats: RunStats = {}) => checkPhotos(stats, Date.now() + 10_000, { scorer, fetch: fetchPicture }).then(() => stats)

  it('passes photographs and holds back emblems', async () => {
    db.rows = [row('1', 's1', 'a.jpg'), row('2', 's2', 'emblem.jpg')]
    const stats = await run()
    expect(db.rows.map((r) => r.image_verdict)).toEqual(['photo', 'emblem'])
    expect(db.rows.every((r) => r.image_hash?.length === 16)).toBe(true)
    expect(stats).toMatchObject({ photos_ok: 1, photos_emblem: 1 })
  })

  const onStories = (n: number, url: string, from = 1) =>
    Array.from({ length: n }, (_, i) => row(`${url}-${from + i}`, `s${from + i}`, url))

  it('retires a picture on REUSE_MIN different stories, but not one fewer share', async () => {
    db.rows = [...onStories(REUSE_MIN, 'card.jpg'), ...onStories(REUSE_MIN - 1, 'b.jpg', 100)]
    const stats = await run()
    expect(db.rows.filter((r) => r.image_url === 'card.jpg').every((r) => r.image_verdict === 'reused')).toBe(true)
    expect(db.rows.filter((r) => r.image_url === 'b.jpg').every((r) => r.image_verdict === 'photo')).toBe(true)
    expect(stats.photos_reused).toBe(REUSE_MIN)
  })

  it('counts one story carrying the picture several times as one', async () => {
    db.rows = [...onStories(REUSE_MIN - 1, 'card.jpg'), row('dup', 's1', 'card.jpg')]
    await run()
    expect(db.rows.every((r) => r.image_verdict === 'photo')).toBe(true)
  })

  it('catches the story that tips a picture over, in a later run', async () => {
    db.rows = onStories(REUSE_MIN - 1, 'card.jpg')
    await run()
    db.rows.push(row('late', 'late', 'card.jpg'))
    await run()
    expect(db.rows.every((r) => r.image_verdict === 'reused')).toBe(true)
  })

  it('leaves an image it could not download unchecked for the next run', async () => {
    db.rows = [row('1', 's1', 'gone.jpg')]
    const stats = await run()
    expect(db.rows[0].image_verdict).toBeNull()
    expect(stats.photos_unreadable).toBe(1)
  })

  it('never judges an article without an image, or one already judged', async () => {
    db.rows = [row('1', 's1', null), { ...row('2', 's2', 'emblem.jpg'), image_verdict: 'photo' }]
    await run()
    expect(db.rows.map((r) => r.image_verdict)).toEqual([null, 'photo'])
  })
})
