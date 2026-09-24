// CLIP's image embedding of a newsroom picture, for the photo head
// (photo-head.ts). No database: the labelling and training scripts use it too.
import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { EMBEDDINGS_CACHE_DIR } from '../embeddings'
import { PHOTO_EMBEDDING_DIM, PHOTO_MODEL, PHOTO_MODEL_REVISION } from './photo-head'

/** Written after the model loads and embeds a probe; gates the workflow's cache save. */
export const PHOTO_CACHE_SENTINEL = join(EMBEDDINGS_CACHE_DIR, `.ok-clip32-q8@${PHOTO_MODEL_REVISION.slice(0, 7)}`)

/** CLIP's embedding of both views, crop then whole: PHOTO_EMBEDDING_DIM numbers. */
export type PhotoEmbedder = (image: Buffer) => Promise<number[]>

// The two views the head reads (PHOTO_VIEWS): the 160x100 centre crop the
// feed's photo band shows, and the whole picture letterboxed on dark grey, so
// the words or logo of a card still count when they sit outside the crop.
// One after the other: sharp work must never overlap (photo-check.ts oneAtATime).
export async function photoViews(image: Buffer): Promise<Buffer[]> {
  const crop = await sharp(image).rotate().resize(160, 100, { fit: 'cover' }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
  const whole = await sharp(image).rotate().resize(224, 224, { fit: 'contain', background: '#202020' }).flatten({ background: '#202020' }).jpeg({ quality: 90 }).toBuffer()
  return [crop, whole]
}

// What the zero-shot pipeline object exposes and this reads. The pipeline is
// the one the model cache was built for; only its image embeddings are used,
// so any one text will do for the text half.
type Clip = {
  tokenizer: (texts: string[], options: { padding: boolean; truncation: boolean }) => Record<string, unknown>
  processor: (images: unknown[]) => Promise<{ pixel_values: unknown }>
  model: (inputs: Record<string, unknown>) => Promise<{ image_embeds: { data: Float32Array } }>
}

let embedderPromise: Promise<PhotoEmbedder> | null = null

async function loadEmbedder(): Promise<PhotoEmbedder> {
  const { pipeline, env, RawImage } = await import('@huggingface/transformers')
  env.cacheDir = EMBEDDINGS_CACHE_DIR
  const clip = (await pipeline('zero-shot-image-classification', PHOTO_MODEL, { revision: PHOTO_MODEL_REVISION, dtype: 'q8' })) as unknown as Clip
  const text = clip.tokenizer(['a photograph'], { padding: true, truncation: true })
  const embedder: PhotoEmbedder = async (image) => {
    const views = []
    for (const view of await photoViews(image)) views.push(await RawImage.fromBlob(new Blob([new Uint8Array(view)], { type: 'image/jpeg' })))
    const { pixel_values } = await clip.processor(views)
    const out = await clip.model({ ...text, pixel_values })
    return Array.from(out.image_embeds.data)
  }
  // Probe, then drop the sentinel that lets the workflow cache the model.
  const probe = await sharp({ create: { width: 160, height: 100, channels: 3, background: '#808080' } }).jpeg().toBuffer()
  const embedding = await embedder(probe)
  if (embedding.length !== PHOTO_EMBEDDING_DIM || !embedding.every(Number.isFinite)) {
    throw new Error(`[photo-embed] probe gave ${embedding.length} values, want ${PHOTO_EMBEDDING_DIM}`)
  }
  try {
    mkdirSync(EMBEDDINGS_CACHE_DIR, { recursive: true })
    writeFileSync(PHOTO_CACHE_SENTINEL, new Date().toISOString())
  } catch {
    // The sentinel is a CI optimisation; never fail the check over it.
  }
  return embedder
}

/** The model, loaded once per process. */
export function photoEmbedder(): Promise<PhotoEmbedder> {
  return (embedderPromise ??= loadEmbedder())
}
