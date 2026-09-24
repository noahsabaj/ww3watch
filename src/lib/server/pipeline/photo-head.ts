// The photo head: whether a newsroom's picture is a photograph, learned from
// pictures on our own feed labelled by hand (data/photo-labels.jsonl, trained
// by scripts/train-photo-head.ts into data/photo-head.json).
//
// It replaced three hand-set cut-offs on CLIP's zero-shot labels ("a logo,
// emblem or seal" and its ratio to "a photograph"). Each new kind of house
// graphic (a TV card, a map, a quote card, a composite of portraits, a
// newspaper front page) needed another rule, and rules loose enough to catch
// them hid real photographs of flags and podiums. A head reads the same model
// as a whole: a logistic layer over the CLIP image embedding of two views of
// the picture, the centre crop the feed's photo band shows and the whole
// picture letterboxed, so a card whose words sit outside the crop is still a
// card. The next miss is fixed by labelling it (scripts/label-photos.ts) and
// retraining, not by another rule.
//
// Pure: no model, no database. photo-check.ts computes the embedding.
import { readFileSync } from 'node:fs'

export const PHOTO_MODEL = 'Xenova/clip-vit-base-patch32'
export const PHOTO_MODEL_REVISION = 'd15189d7028b43f1d3e65039190477f6af591c2a'
/** How the two views are cut (photo-check.ts photoViews). Change them and
 *  every stored embedding and the head must be made again. */
export const PHOTO_VIEWS = 'crop160x100-white+contain224-202020'
export const PHOTO_EMBEDDING_DIM = 1024
export const PHOTO_HEAD_PATH = 'data/photo-head.json'
export const PHOTO_LABELS_PATH = 'data/photo-labels.jsonl'

/** Which model, weights and views an embedding (and a head) belongs to. */
export const PHOTO_TAG = `${PHOTO_MODEL}@${PHOTO_MODEL_REVISION.slice(0, 7)}:q8:${PHOTO_VIEWS}`

export interface PhotoHead {
  tag: string
  trained_at: string
  n_photo: number
  n_other: number
  weights: number[]
  bias: number
  /** P(photograph) at or above which a picture is shown. */
  photo_min: number
  cv?: Record<string, unknown>
}

export function validatePhotoHead(head: PhotoHead): string[] {
  const problems: string[] = []
  if (head.tag !== PHOTO_TAG) problems.push(`tag ${head.tag} is not ${PHOTO_TAG}`)
  if (!Array.isArray(head.weights) || head.weights.length !== PHOTO_EMBEDDING_DIM) problems.push(`weights: want ${PHOTO_EMBEDDING_DIM}`)
  else if (!head.weights.every(Number.isFinite)) problems.push('weights: not all finite')
  if (!Number.isFinite(head.bias)) problems.push('bias: not finite')
  if (!(head.photo_min > 0 && head.photo_min < 1)) problems.push('photo_min out of (0,1)')
  return problems
}

/** The committed head. Throws when it does not match the model and views the
 *  pipeline embeds with: better no photos than unchecked ones. */
export function loadPhotoHead(path = PHOTO_HEAD_PATH): PhotoHead {
  const head = JSON.parse(readFileSync(path, 'utf8')) as PhotoHead
  const problems = validatePhotoHead(head)
  if (problems.length) throw new Error(`[photo-head] ${path} unusable: ${problems.join('; ')}`)
  return head
}

/** P(photograph) for an embedding from photo-check.ts. */
export function photoProbability(head: Pick<PhotoHead, 'weights' | 'bias'>, embedding: ArrayLike<number>): number {
  let z = head.bias
  for (let i = 0; i < head.weights.length; i++) z += head.weights[i] * embedding[i]
  return 1 / (1 + Math.exp(-z))
}

// Stored embeddings (data/photo-labels.jsonl) are unit vectors of 512 halves;
// int8 at 1/127 steps keeps the labels file small and costs the head nothing
// measurable.
export function packEmbedding(embedding: ArrayLike<number>): string {
  const bytes = new Int8Array(embedding.length)
  for (let i = 0; i < embedding.length; i++) bytes[i] = Math.max(-127, Math.min(127, Math.round(embedding[i] * 127)))
  return Buffer.from(bytes.buffer).toString('base64')
}

export function unpackEmbedding(packed: string): number[] {
  const buf = Buffer.from(packed, 'base64')
  return Array.from(new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength), (b) => b / 127)
}

/** One hand label. `photo` true: a photograph readers should see. */
export interface PhotoLabel {
  article_id: string
  image_url: string
  photo: boolean
  tag: string
  emb: string
}
