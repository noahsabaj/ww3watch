// The photo check: every newsroom image is looked at once before the site
// shows it (articles.image_verdict; the client shows only 'photo').
//
// What feeds pass off as photographs, first measured on 386 images from the
// live feed on 2026-09-23:
//   - emblems: a logo, seal or emblem on a plain ground (the UN emblem on a UN
//     story, the Iranian armed forces' seal on two outlets' stories). A local
//     CLIP model scores "a logo, emblem or seal" against "a photograph". The
//     three emblems scored 0.993-0.994; the highest photograph (a Saudi flag
//     on a pole) 0.934. EMBLEM_MIN sits between, nearer the emblems.
//   - logos with words in them: the model splits what is not a photograph
//     between the logo label and the TV-graphic one. The UAE aviation
//     authority's logo, its name printed under the bird, read 0.92 logo, 0.08
//     graphic and 0.003 photograph, so it passed EMBLEM_MIN and was shown
//     (2026-09-24). Weighed against a photograph alone it reads 0.997. Over
//     4,614 images from the two days to 2026-09-24, LOGO_OVER_PHOTO_MIN caught
//     17 that EMBLEM_MIN missed: 6 logos and statement graphics (the IRGC
//     emblem, Kayhan's masthead, Al Jazeera's "breaking" card), 8 photographs
//     of a seal or emblem on a podium, wall or floor, 2 close-ups of uniform
//     patches and a flag. The nearest photograph of people, the Palestinian
//     president on the UN's screen beside its emblem, read 0.989; below it,
//     flags on poles and speakers at seal-fronted podiums mix with logos, so
//     the line stays above them.
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
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { supabaseAdmin } from '../supabase'
import { mapPool } from '../pool'
import { EMBEDDINGS_CACHE_DIR } from '../embeddings'
import { dueForRetry, fetchImage, stampUnreadable } from './images'
import { UNREADABLE_RETRY_MINUTES } from '../config'
import { bump, type RunStats } from './stats'

export const PHOTO_MODEL = 'Xenova/clip-vit-base-patch32'
export const PHOTO_MODEL_REVISION = 'd15189d7028b43f1d3e65039190477f6af591c2a'
/** Written after the model loads and scores a probe; gates the workflow's cache save. */
export const PHOTO_CACHE_SENTINEL = join(EMBEDDINGS_CACHE_DIR, `.ok-clip32-q8@${PHOTO_MODEL_REVISION.slice(0, 7)}`)

// The labels are part of the calibration: change one and re-measure EMBLEM_MIN
// and LOGO_OVER_PHOTO_MIN.
const LABELS = ['a photograph', 'a logo, emblem or seal', 'a graphic with a TV channel logo and text'] as const
export const EMBLEM_MIN = 0.97
export const LOGO_OVER_PHOTO_MIN = 0.99
export const REUSE_MIN = 6
export const IMAGE_CHECK_CAP = 150
export const IMAGE_CHECK_CONCURRENCY = 6
export const IMAGE_CHECK_LOOKBACK_HOURS = 48
const REUSE_WINDOW_HOURS = 72

export type Verdict = 'photo' | 'emblem' | 'reused'
/** The model's reading of an image on each label; the three sum to 1. */
export type LabelScores = { photo: number; logo: number; graphic: number }
export type EmblemScorer = (image: Buffer) => Promise<LabelScores>

/** An emblem: the logo label alone is sure, or it is when weighed against a
 *  photograph alone, leaving out what went to the TV-graphic label. */
export function isEmblem(s: LabelScores): boolean {
  if (s.logo >= EMBLEM_MIN) return true
  const photoOrLogo = s.photo + s.logo
  return photoOrLogo > 0 && s.logo / photoOrLogo >= LOGO_OVER_PHOTO_MIN
}

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

// The model sees what it was calibrated on: a 160x100 centre crop, as the
// feed's photo band shows it.
async function thumbnail(image: Buffer): Promise<Buffer> {
  return sharp(image).rotate().resize(160, 100, { fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
}

let scorerPromise: Promise<EmblemScorer> | null = null

async function loadScorer(): Promise<EmblemScorer> {
  const { pipeline, env, RawImage } = await import('@huggingface/transformers')
  env.cacheDir = EMBEDDINGS_CACHE_DIR
  const classify = await pipeline('zero-shot-image-classification', PHOTO_MODEL, { revision: PHOTO_MODEL_REVISION, dtype: 'q8' })
  const scorer: EmblemScorer = async (image) => {
    const raw = await RawImage.fromBlob(new Blob([new Uint8Array(await thumbnail(image))], { type: 'image/jpeg' }))
    const out = (await classify(raw, [...LABELS])) as Array<{ label: string; score: number }>
    const p = (label: string) => out.find((o) => o.label === label)?.score ?? 0
    return { photo: p(LABELS[0]), logo: p(LABELS[1]), graphic: p(LABELS[2]) }
  }
  // Probe, then drop the sentinel that lets the workflow cache the model.
  const probe = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#808080' } }).jpeg().toBuffer()
  const { logo: score } = await scorer(probe)
  if (!(score >= 0 && score <= 1)) throw new Error(`[photo-check] probe scored ${score}`)
  try {
    mkdirSync(EMBEDDINGS_CACHE_DIR, { recursive: true })
    writeFileSync(PHOTO_CACHE_SENTINEL, new Date().toISOString())
  } catch {
    // The sentinel is a CI optimisation; never fail the check over it.
  }
  return scorer
}

/** The model, loaded once per process. */
export function photoScorer(): Promise<EmblemScorer> {
  return (scorerPromise ??= loadScorer())
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
  scorer: EmblemScorer,
  hash: (image: Buffer) => Promise<string> = differenceHash,
): Promise<{ verdict: Verdict; hash: string }> {
  // One after the other, never together (see oneAtATime).
  const hashed = await hash(image)
  const scores = await scorer(image)
  return { hash: hashed, verdict: isEmblem(scores) ? 'emblem' : 'photo' }
}

type Row = { id: string; image_url: string }

export async function checkPhotos(
  stats: RunStats,
  deadlineMs: number,
  deps: {
    scorer?: EmblemScorer
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

    const scorer = deps.scorer ?? (await photoScorer())
    const judge = oneAtATime((image: Buffer) => judgeImage(image, scorer, deps.hash))
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
    bump(stats, 'photos_emblem', verdicts.filter((v) => v === 'emblem').length)
    bump(stats, 'photos_unreadable', verdicts.filter((v) => v === null).length)
    bump(stats, 'photos_failed', result.failed.length)
    bump(stats, 'photos_deferred', result.skipped.length)
    bump(stats, 'photos_reused', await markReused([...hashes]))
    console.log(
      `[pipeline] photo check: ok=${stats.photos_ok ?? 0} emblem=${stats.photos_emblem ?? 0} ` +
        `reused=${stats.photos_reused ?? 0} unreadable=${stats.photos_unreadable ?? 0} (tried again in ${UNREADABLE_RETRY_MINUTES} min)`,
    )
  } catch (err) {
    stats.photos_error = String(err).slice(0, 200)
    console.error('[pipeline] photo check failed (non-fatal):', err)
  }
}

/** Judge again every picture passed within IMAGE_CHECK_LOOKBACK_HOURS, after
 *  the rule changes (scripts/recheck-photos.ts). A picture is scored once
 *  however many articles carry it, and only a verdict that changes is written. */
export async function recheckPhotos(
  deadlineMs: number,
  deps: { scorer?: EmblemScorer; fetch?: (url: string) => Promise<Buffer | null> } = {},
): Promise<{ pictures: number; retired: number; unreadable: number; deferred: number }> {
  const since = new Date(Date.now() - IMAGE_CHECK_LOOKBACK_HOURS * 3600_000).toISOString()
  const rows: Array<{ id: string; image_url: string; image_hash: string | null }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('articles')
      .select('id, image_url, image_hash')
      .eq('image_verdict', 'photo')
      .gte('published_at', since)
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...((data ?? []) as typeof rows))
    if (!data || data.length < 1000) break
  }
  const pictures = new Map<string, { url: string; ids: string[] }>()
  for (const r of rows) {
    const key = r.image_hash ?? r.image_url
    const p = pictures.get(key)
    if (p) p.ids.push(r.id)
    else pictures.set(key, { url: r.image_url, ids: [r.id] })
  }
  const scorer = deps.scorer ?? (await photoScorer())
  const judge = oneAtATime((image: Buffer) => judgeImage(image, scorer))
  const download = deps.fetch ?? fetchImage
  let retired = 0
  let unreadable = 0
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
      if (verdict === 'photo') return
      for (let i = 0; i < p.ids.length; i += 100) {
        const { error } = await supabaseAdmin.from('articles').update({ image_verdict: verdict }).in('id', p.ids.slice(i, i + 100))
        if (error) throw new Error(error.message)
      }
      retired += p.ids.length
    },
    { deadlineMs },
  )
  if (result.failed.length) console.error(`[photo-check] recheck: ${result.failed.length} failed:`, String(result.failed[0].error).slice(0, 200))
  return { pictures: pictures.size, retired, unreadable, deferred: result.skipped.length }
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
