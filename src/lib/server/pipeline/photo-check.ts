// The photo check: every newsroom image is looked at once before the site
// shows it (articles.image_verdict; the client shows only 'photo').
//
// Two things feeds pass off as photographs:
//   - graphics: logos, seals and emblems, TV and quote cards, maps,
//     composites of portraits, newspaper front pages. The photo head
//     (photo-head.ts), trained on pictures from our own feed labelled by hand,
//     says whether a picture is a photograph; below its photo_min it is a
//     'graphic' and never shown. It replaced hand-set cut-offs on CLIP's
//     zero-shot labels, which needed a new rule for each new kind of card.
//   - reuse: one picture on many unrelated stories. Over 48 hours of production
//     house pictures sat on 8 (The Print's default image), 25 (Arutz Sheva's
//     "Breaking News" card) and 34 stories (one Middle East Eye UN General
//     Assembly photo, on oil prices, Gaza and more), while a real photo of one
//     event sat on at most 5 (the same meeting reported as several stories).
//     REUSE_MIN sits between.
//
// An image we cannot download or decode stays unchecked and is tried again
// after UNREADABLE_RETRY_MINUTES (every run, it took ~140 of each run's 150
// slots); IMAGE_CHECK_LOOKBACK_HOURS retires it.
import sharp from 'sharp'
import { supabaseAdmin } from '../supabase'
import { mapPool } from '../pool'
import { dueForRetry, fetchImage, stampUnreadable } from './images'
import { UNREADABLE_RETRY_MINUTES } from '../config'
import { bump, type RunStats } from './stats'
import { loadPhotoHead, photoProbability, type PhotoHead } from './photo-head'
import { photoEmbedder } from './photo-embed'

export { PHOTO_MODEL, PHOTO_MODEL_REVISION } from './photo-head'
export { PHOTO_CACHE_SENTINEL } from './photo-embed'

export const REUSE_MIN = 6
export const IMAGE_CHECK_CAP = 150
export const IMAGE_CHECK_CONCURRENCY = 6
export const IMAGE_CHECK_LOOKBACK_HOURS = 48
const REUSE_WINDOW_HOURS = 72

export type Verdict = 'photo' | 'graphic' | 'reused'
/** P(photograph) for a picture, and the line at or above which it is shown. */
export type PhotoJudge = { score: (image: Buffer) => Promise<number>; photoMin: number }

/** 64-bit difference hash: survives resizing and recompression, so the same
 *  picture served at two sizes still matches. */
export async function differenceHash(image: Buffer): Promise<string> {
  const data = await sharp(image).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
  let hash = 0n
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) hash = (hash << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n)
  }
  return hash.toString(16).padStart(16, '0')
}

/** The model and the committed head (data/photo-head.json), loaded once. */
export async function photoJudge(head: PhotoHead = loadPhotoHead()): Promise<PhotoJudge> {
  const embed = await photoEmbedder()
  return { score: async (image) => photoProbability(head, await embed(image)), photoMin: head.photo_min }
}

// One image's native work at a time: its hash, then the model. Once real images
// reached the check (#159) the process aborted natively on the runner
// ("free(): double free", "malloc(): unaligned tcache chunk", SIGSEGV) in 11 of
// 14 pipeline runs and in 3 of 3 backfills (the longest judged 730 images, then
// died in its third pass). Queueing only the model call (#165) changed nothing:
// ONNX Runtime's Node binding already runs the model on the main thread, one
// call at a time. What did overlap was sharp (libvips) on Node's thread pool,
// for other images and for this image's hash, and that is where a core dump
// caught the abort: inside libvips on a thread-pool thread, with ONNX Runtime
// idle. With each image's native work in turn, a backfill judged the whole
// backlog (1,214 images) without a crash. It is no slower: over the same images,
// read-only, 450 took 82s this way and 81s the old way, since the model was
// already the one-at-a-time part. Downloads still run six at a time. The
// pipeline also runs this stage in its own process (photo-check-isolated.ts),
// so if anything still crashes, only this stage is lost.
export function oneAtATime<A, R>(fn: (arg: A) => Promise<R>): (arg: A) => Promise<R> {
  let queue: Promise<unknown> = Promise.resolve()
  return (arg) => {
    const next = queue.then(() => fn(arg))
    queue = next.catch(() => {})
    return next
  }
}

export async function judgeImage(
  image: Buffer,
  judge: PhotoJudge,
  hash: (image: Buffer) => Promise<string> = differenceHash,
): Promise<{ verdict: Exclude<Verdict, 'reused'>; hash: string }> {
  // One after the other, never together (see oneAtATime).
  const hashed = await hash(image)
  const p = await judge.score(image)
  return { hash: hashed, verdict: p >= judge.photoMin ? 'photo' : 'graphic' }
}

type Row = { id: string; image_url: string }

export async function checkPhotos(
  stats: RunStats,
  deadlineMs: number,
  deps: {
    judge?: PhotoJudge
    hash?: (image: Buffer) => Promise<string>
    fetch?: (url: string) => Promise<Buffer | null>
    cap?: number
  } = {},
): Promise<void> {
  try {
    const since = new Date(Date.now() - IMAGE_CHECK_LOOKBACK_HOURS * 3600_000).toISOString()
    const { data, error } = await supabaseAdmin
      .from('articles')
      .select('id, image_url')
      .not('image_url', 'is', null)
      .is('image_verdict', null)
      .or(dueForRetry('image_check_failed_at'))
      .gte('published_at', since)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(deps.cap ?? IMAGE_CHECK_CAP)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Row[]
    if (rows.length === 0) return

    const photo = deps.judge ?? (await photoJudge())
    const judge = oneAtATime((image: Buffer) => judgeImage(image, photo, deps.hash))
    const download = deps.fetch ?? fetchImage
    const hashes = new Set<string>()
    const unreadable: string[] = []
    const result = await mapPool(
      rows,
      IMAGE_CHECK_CONCURRENCY,
      async (row) => {
        const image = await download(row.image_url)
        if (!image) {
          unreadable.push(row.id)
          return null
        }
        const { verdict, hash } = await judge(image).catch((err: unknown) => {
          unreadable.push(row.id)
          throw err
        })
        const { error: updateError } = await supabaseAdmin
          .from('articles')
          .update({ image_verdict: verdict, image_hash: hash })
          .eq('id', row.id)
        if (updateError) throw new Error(updateError.message)
        hashes.add(hash)
        return verdict
      },
      { deadlineMs },
    )

    await stampUnreadable('image_check_failed_at', unreadable)
    const verdicts = result.done.map((d) => d.value)
    bump(stats, 'photos_ok', verdicts.filter((v) => v === 'photo').length)
    bump(stats, 'photos_graphic', verdicts.filter((v) => v === 'graphic').length)
    bump(stats, 'photos_unreadable', verdicts.filter((v) => v === null).length)
    bump(stats, 'photos_failed', result.failed.length)
    bump(stats, 'photos_deferred', result.skipped.length)
    bump(stats, 'photos_reused', await markReused([...hashes]))
    console.log(
      `[pipeline] photo check: ok=${stats.photos_ok ?? 0} graphic=${stats.photos_graphic ?? 0} ` +
        `reused=${stats.photos_reused ?? 0} unreadable=${stats.photos_unreadable ?? 0} (tried again in ${UNREADABLE_RETRY_MINUTES} min)`,
    )
  } catch (err) {
    stats.photos_error = String(err).slice(0, 200)
    console.error('[pipeline] photo check failed (non-fatal):', err)
  }
}

/** Judge again every picture checked within IMAGE_CHECK_LOOKBACK_HOURS, after
 *  the head changes (scripts/recheck-photos.ts). A picture is scored once
 *  however many articles carry it, and only verdicts that change are written.
 *  Reused pictures stay retired: that verdict is about where a picture
 *  appears, not what it shows. */
export async function recheckPhotos(
  deadlineMs: number,
  deps: { judge?: PhotoJudge; fetch?: (url: string) => Promise<Buffer | null> } = {},
): Promise<{ pictures: number; hidden: number; shown: number; reused: number; unreadable: number; deferred: number }> {
  const since = new Date(Date.now() - IMAGE_CHECK_LOOKBACK_HOURS * 3600_000).toISOString()
  const rows: Array<{ id: string; image_url: string; image_hash: string | null; image_verdict: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('articles')
      .select('id, image_url, image_hash, image_verdict')
      .in('image_verdict', ['photo', 'graphic', 'emblem'])
      .gte('published_at', since)
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as typeof rows))
    if (!data || data.length < 1000) break
  }
  const pictures = new Map<string, { url: string; hash: string | null; rows: Array<{ id: string; verdict: string }> }>()
  for (const r of rows) {
    const key = r.image_hash ?? r.image_url
    const p = pictures.get(key)
    if (p) p.rows.push({ id: r.id, verdict: r.image_verdict })
    else pictures.set(key, { url: r.image_url, hash: r.image_hash, rows: [{ id: r.id, verdict: r.image_verdict }] })
  }
  const photo = deps.judge ?? (await photoJudge())
  const judge = oneAtATime((image: Buffer) => judgeImage(image, photo))
  const download = deps.fetch ?? fetchImage
  let hidden = 0
  let shown = 0
  let unreadable = 0
  const nowPhotos: string[] = []
  const result = await mapPool(
    [...pictures.values()],
    IMAGE_CHECK_CONCURRENCY,
    async (p) => {
      const image = await download(p.url)
      if (!image) {
        unreadable++
        return
      }
      const { verdict } = await judge(image)
      const changed = p.rows.filter((r) => r.verdict !== verdict).map((r) => r.id)
      for (let i = 0; i < changed.length; i += 100) {
        const { error } = await supabaseAdmin.from('articles').update({ image_verdict: verdict }).in('id', changed.slice(i, i + 100))
        if (error) throw new Error(error.message)
      }
      if (verdict === 'graphic') hidden += p.rows.filter((r) => r.verdict === 'photo').length
      else {
        shown += changed.length
        if (changed.length && p.hash) nowPhotos.push(p.hash)
      }
    },
    { deadlineMs },
  )
  if (result.failed.length) console.error(`[photo-check] recheck: ${result.failed.length} failed:`, String(result.failed[0].error).slice(0, 200))
  const reused = await markReused(nowPhotos)
  return { pictures: pictures.size, hidden, shown, reused, unreadable, deferred: result.skipped.length }
}

/** Retire every copy of a picture that is on REUSE_MIN or more different
 *  stories. Returns how many rows it retired. */
export async function markReused(hashes: string[]): Promise<number> {
  if (hashes.length === 0) return 0
  const since = new Date(Date.now() - REUSE_WINDOW_HOURS * 3600_000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('articles')
    .select('id, story_id, image_hash, image_verdict')
    .in('image_hash', hashes)
    .gte('published_at', since)
  if (error) throw new Error(error.message)
  const byHash = new Map<string, Array<{ id: string; story: string; verdict: string | null }>>()
  for (const r of data ?? []) {
    const list = byHash.get(r.image_hash!) ?? []
    list.push({ id: r.id, story: r.story_id ?? r.id, verdict: r.image_verdict })
    byHash.set(r.image_hash!, list)
  }
  const retire = [...byHash.values()]
    .filter((list) => new Set(list.map((r) => r.story)).size >= REUSE_MIN)
    .flat()
    .filter((r) => r.verdict === 'photo')
    .map((r) => r.id)
  if (retire.length === 0) return 0
  const { error: updateError } = await supabaseAdmin.from('articles').update({ image_verdict: 'reused' }).in('id', retire)
  if (updateError) throw new Error(updateError.message)
  return retire.length
}
