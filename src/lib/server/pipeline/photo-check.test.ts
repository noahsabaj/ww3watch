import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

type Row = { id: string; story_id: string | null; image_url: string | null; published_at: string; image_verdict: string | null; image_hash: string | null; image_check_failed_at: string | null }
const db = vi.hoisted(() => ({ rows: [] as Row[] }))

// A tiny in-memory articles table: just the filters the stage uses.
vi.mock('../supabase', () => {
  function query(rows: () => Row[]) {
    const filters: Array<(r: Row) => boolean> = []
    let patch: Partial<Row> | null = null
    let limit = Infinity
    let offset = 0
    const q = {
      select: () => q,
      update: (p: Partial<Row>) => { patch = p; return q },
      not: (col: keyof Row, _op: string, _v: null) => { filters.push((r) => r[col] !== null); return q },
      is: (col: keyof Row, _v: null) => { filters.push((r) => r[col] === null); return q },
      gte: (col: keyof Row, v: string) => { filters.push((r) => String(r[col]) >= v); return q },
      eq: (col: keyof Row, v: unknown) => { filters.push((r) => r[col] === v); return q },
      in: (col: keyof Row, vs: unknown[]) => { filters.push((r) => vs.includes(r[col])); return q },
      // Only the retry filter the stage builds: `<col>.is.null,<col>.lt."<iso>"`.
      or: (expr: string) => {
        const m = /^(\w+)\.is\.null,\1\.lt\."([^"]+)"$/.exec(expr)
        if (!m) throw new Error(`unexpected or(): ${expr}`)
        const col = m[1] as keyof Row
        filters.push((r) => r[col] === null || String(r[col]) < m[2])
        return q
      },
      order: () => q,
      limit: (n: number) => { limit = n; return q },
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; return q },
      then(resolve: (v: { data: Row[] | null; error: null }) => void) {
        const hit = rows().filter((r) => filters.every((f) => f(r))).slice(offset, offset + limit)
        if (patch) for (const r of hit) Object.assign(r, patch)
        resolve({ data: patch ? null : hit.map((r) => ({ ...r })), error: null })
      },
    }
    return q
  }
  return { supabaseAdmin: { from: () => query(() => db.rows) } }
})

import { checkPhotos, differenceHash, judgeImage, oneAtATime, recheckPhotos, REUSE_MIN, type PhotoJudge } from './photo-check'
import { UNREADABLE_RETRY_MINUTES } from '../config'
import type { RunStats } from './stats'

const now = new Date().toISOString()
const row = (id: string, story: string | null, url: string | null): Row =>
  ({ id, story_id: story, image_url: url, published_at: now, image_verdict: null, image_hash: null, image_check_failed_at: null })

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
// 'emblem.jpg' stands for any graphic: the head gives it a low P(photograph).
const scorer = async (image: Buffer) => (image.equals(pictures['emblem.jpg']) ? 0.02 : 0.95)
const judge: PhotoJudge = { score: scorer, photoMin: 0.5 }

beforeEach(async () => {
  db.rows = []
  pictures = { 'a.jpg': await picture(1), 'b.jpg': await picture(2), 'card.jpg': await picture(3), 'emblem.jpg': await picture(4) }
})

describe('judgeImage', () => {
  it('calls a picture a photograph at or above photo_min, and a graphic below it', async () => {
    const img = pictures['a.jpg']
    expect((await judgeImage(img, { score: async () => 0.5, photoMin: 0.5 })).verdict).toBe('photo')
    expect((await judgeImage(img, { score: async () => 0.49, photoMin: 0.5 })).verdict).toBe('graphic')
  })

  it('hashes, then calls the model, never both at once', async () => {
    const steps: string[] = []
    const step = (name: string, value: unknown) => async () => {
      steps.push(`${name} start`)
      await new Promise((r) => setTimeout(r, 5))
      steps.push(`${name} end`)
      return value
    }
    await judgeImage(pictures['a.jpg'], { score: step('model', 0.9) as () => Promise<number>, photoMin: 0.5 }, step('hash', '0') as () => Promise<string>)
    expect(steps).toEqual(['hash start', 'hash end', 'model start', 'model end'])
  })

  it('hashes the same picture the same at any size, and different pictures differently', async () => {
    const big = await sharp(pictures['a.jpg']).resize(640, 400).jpeg({ quality: 60 }).toBuffer()
    expect(await differenceHash(big)).toBe(await differenceHash(pictures['a.jpg']))
    expect(await differenceHash(pictures['b.jpg'])).not.toBe(await differenceHash(pictures['a.jpg']))
  })
})

describe('checkPhotos', () => {
  const run = (stats: RunStats = {}) => checkPhotos(stats, Date.now() + 10_000, { judge, fetch: fetchPicture }).then(() => stats)

  it('passes photographs and holds back graphics', async () => {
    db.rows = [row('1', 's1', 'a.jpg'), row('2', 's2', 'emblem.jpg')]
    const stats = await run()
    expect(db.rows.map((r) => r.image_verdict)).toEqual(['photo', 'graphic'])
    expect(db.rows.every((r) => r.image_hash?.length === 16)).toBe(true)
    expect(stats).toMatchObject({ photos_ok: 1, photos_graphic: 1 })
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

  it('leaves an image it could not download unchecked, and tries it again an hour later, not every run', async () => {
    db.rows = [row('1', 's1', 'gone.jpg')]
    const fetch = vi.fn(fetchPicture)
    const go = () => checkPhotos({}, Date.now() + 10_000, { judge, fetch })
    const stats: RunStats = {}
    await checkPhotos(stats, Date.now() + 10_000, { judge, fetch })
    expect(db.rows[0].image_verdict).toBeNull()
    expect(stats.photos_unreadable).toBe(1)
    expect(db.rows[0].image_check_failed_at).not.toBeNull()
    await go()
    expect(fetch).toHaveBeenCalledTimes(1)
    // An hour on, the picture is back.
    db.rows[0].image_check_failed_at = new Date(Date.now() - (UNREADABLE_RETRY_MINUTES + 1) * 60_000).toISOString()
    pictures['gone.jpg'] = pictures['a.jpg']
    await go()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(db.rows[0].image_verdict).toBe('photo')
  })

  it('makes a picture that will not decode wait an hour too', async () => {
    db.rows = [row('1', 's1', 'bad.jpg')]
    pictures['bad.jpg'] = Buffer.from('not an image')
    const stats = await run()
    expect(stats.photos_failed).toBe(1)
    expect(db.rows[0].image_verdict).toBeNull()
    expect(db.rows[0].image_check_failed_at).not.toBeNull()
  })

  it('hashes and calls the model for one image at a time, though downloads run in parallel', async () => {
    db.rows = [row('1', 's1', 'a.jpg'), row('2', 's2', 'b.jpg'), row('3', 's3', 'card.jpg'), row('4', 's4', 'emblem.jpg')]
    const pause = () => new Promise((r) => setTimeout(r, 5))
    let downloading = 0, mostDownloads = 0, native = 0, mostNative = 0
    const busy = async <T>(fn: () => Promise<T>): Promise<T> => {
      mostNative = Math.max(mostNative, ++native)
      await pause()
      try {
        return await fn()
      } finally {
        native--
      }
    }
    await checkPhotos({}, Date.now() + 10_000, {
      fetch: async (url) => {
        mostDownloads = Math.max(mostDownloads, ++downloading)
        await pause()
        downloading--
        return fetchPicture(url)
      },
      hash: (image) => busy(() => differenceHash(image)),
      judge: { score: (image) => busy(() => scorer(image)), photoMin: 0.5 },
    })
    expect(mostDownloads).toBeGreaterThan(1)
    expect(mostNative).toBe(1)
    expect(db.rows.map((r) => r.image_verdict)).toEqual(['photo', 'photo', 'photo', 'graphic'])
  })

  it('keeps the queue moving after a failed call', async () => {
    const flaky = oneAtATime(async (image: Buffer) => { if (image.length === 1) throw new Error('bad'); return 0.1 })
    await expect(flaky(Buffer.from([1]))).rejects.toThrow('bad')
    await expect(flaky(Buffer.from([1, 2]))).resolves.toBe(0.1)
  })

  it('never judges an article without an image, or one already judged', async () => {
    db.rows = [row('1', 's1', null), { ...row('2', 's2', 'emblem.jpg'), image_verdict: 'photo' }]
    await run()
    expect(db.rows.map((r) => r.image_verdict)).toEqual([null, 'photo'])
  })
})

describe('recheckPhotos', () => {
  it('judges checked pictures again, once each, and writes only verdicts that change', async () => {
    const judged = (id: string, url: string, hash: string, verdict: string): Row => ({ ...row(id, `s${id}`, url), image_verdict: verdict, image_hash: hash })
    db.rows = [
      judged('1', 'emblem.jpg', 'e', 'photo'), // shown, now caught
      judged('2', 'emblem.jpg', 'e', 'photo'),
      judged('3', 'a.jpg', 'a', 'photo'), // stays
      judged('4', 'b.jpg', 'b', 'emblem'), // a photograph the old rule hid
      judged('5', 'card.jpg', 'c', 'reused'), // where a picture appears is not re-judged
    ]
    let calls = 0
    const counting: PhotoJudge = { score: async (image) => { calls++; return scorer(image) }, photoMin: 0.5 }
    const result = await recheckPhotos(Date.now() + 10_000, { judge: counting, fetch: fetchPicture })
    expect(db.rows.map((r) => r.image_verdict)).toEqual(['graphic', 'graphic', 'photo', 'photo', 'reused'])
    expect(calls).toBe(3)
    expect(result).toMatchObject({ pictures: 3, hidden: 2, shown: 1, unreadable: 0 })
  })
})
