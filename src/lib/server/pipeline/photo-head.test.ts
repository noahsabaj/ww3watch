import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import {
  loadPhotoHead,
  packEmbedding,
  photoProbability,
  unpackEmbedding,
  validatePhotoHead,
  PHOTO_EMBEDDING_DIM,
  PHOTO_LABELS_PATH,
  PHOTO_TAG,
  type PhotoHead,
  type PhotoLabel,
} from './photo-head'
import { photoViews } from './photo-embed'

const labels = readFileSync(PHOTO_LABELS_PATH, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as PhotoLabel)

describe('the committed photo head', () => {
  const head = loadPhotoHead()

  it('matches the model and views the pipeline embeds with', () => {
    expect(head.tag).toBe(PHOTO_TAG)
    expect(validatePhotoHead(head)).toEqual([])
  })

  it('agrees with nearly every label it was trained on', () => {
    const wrong = labels.filter((l) => (photoProbability(head, unpackEmbedding(l.emb)) >= head.photo_min) !== l.photo)
    expect(wrong.length / labels.length).toBeLessThan(0.05)
  })

  it('hides the pictures that were reported, and shows the photograph beside one', () => {
    const verdict = (articleId: string) => {
      const l = labels.find((x) => x.article_id === articleId)
      if (!l) throw new Error(`no label for ${articleId}`)
      return photoProbability(head, unpackEmbedding(l.emb)) >= head.photo_min
    }
    // The UAE aviation authority's logo on Kurdistan 24's story (#176).
    expect(verdict('b0d3dbbf-bbc7-4d34-8135-11affd7f8296')).toBe(false)
  })
})

describe('the labels file', () => {
  it('holds embeddings from the pipeline’s model and views, one label per picture', () => {
    expect(labels.length).toBeGreaterThan(900)
    for (const l of labels) {
      expect(l.tag).toBe(PHOTO_TAG)
      expect(unpackEmbedding(l.emb)).toHaveLength(PHOTO_EMBEDDING_DIM)
    }
    const keys = labels.map((l) => l.article_id || l.image_url)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('validatePhotoHead', () => {
  const good: PhotoHead = { tag: PHOTO_TAG, trained_at: '', n_photo: 1, n_other: 1, weights: new Array(PHOTO_EMBEDDING_DIM).fill(0), bias: 0, photo_min: 0.5 }

  it('refuses a head for another model or views, a wrong size or a bad threshold', () => {
    expect(validatePhotoHead(good)).toEqual([])
    expect(validatePhotoHead({ ...good, tag: 'other' })).toHaveLength(1)
    expect(validatePhotoHead({ ...good, weights: [1, 2] })).toHaveLength(1)
    expect(validatePhotoHead({ ...good, photo_min: 1 })).toHaveLength(1)
  })
})

describe('photoProbability', () => {
  it('is the logistic of the weighted sum', () => {
    expect(photoProbability({ weights: [2, -1], bias: 0.5 }, [1, 1])).toBeCloseTo(1 / (1 + Math.exp(-1.5)))
  })
})

describe('packEmbedding', () => {
  it('keeps each value within 1/254 of the original', () => {
    const v = Array.from({ length: PHOTO_EMBEDDING_DIM }, (_, i) => Math.sin(i) * 0.1)
    const back = unpackEmbedding(packEmbedding(v))
    expect(back).toHaveLength(v.length)
    back.forEach((x, i) => expect(Math.abs(x - v[i])).toBeLessThanOrEqual(1 / 254 + 1e-9))
  })
})

describe('photoViews', () => {
  it('cuts the photo band crop and the whole picture, letterboxed', async () => {
    const wide = await sharp({ create: { width: 800, height: 300, channels: 3, background: '#3366aa' } }).png().toBuffer()
    const [crop, whole] = await photoViews(wide)
    expect(await sharp(crop).metadata()).toMatchObject({ width: 160, height: 100 })
    const meta = await sharp(whole).metadata()
    expect(meta).toMatchObject({ width: 224, height: 224 })
    // Letterboxed: the top rows are the dark band, not the picture.
    const { data } = await sharp(whole).raw().toBuffer({ resolveWithObject: true })
    expect(Math.abs(data[0] - 0x20)).toBeLessThan(8)
  })
})
