import { describe, it, expect } from 'vitest'
import { photoSrc, resizedUrl } from './photo-src'

const original = 'https://images.example.com/a b.jpg?x=1'
const width = (src: string) => Number(new URL(src).searchParams.get('w'))

describe('photo-src', () => {
  it('resizes through wsrv as WebP, never enlarging, with the original URL encoded', () => {
    expect(resizedUrl(original, 800)).toBe(
      'https://wsrv.nl/?url=https%3A%2F%2Fimages.example.com%2Fa%20b.jpg%3Fx%3D1&w=800&output=webp&q=72&we',
    )
  })

  it('asks for the drawn width at the pixel ratio, rounded up to an offered width', () => {
    expect(width(photoSrc(original, 360, 375, 2))).toBe(800)
    expect(width(photoSrc(original, 360, 375, 3))).toBe(1200)
    expect(width(photoSrc(original, 96, 64, 3))).toBe(240)
    expect(width(photoSrc(original, 640, 1400, 2))).toBe(1200)
  })

  it("never asks below the surface's minimum, so the minimum-width check still judges the original", () => {
    expect(width(photoSrc(original, 360, 300, 1))).toBe(480)
    expect(width(photoSrc(original, 640, 500, 1))).toBe(800)
  })

  it('leaves relative URLs (our own fixtures) alone', () => {
    expect(photoSrc('/fixtures/story-photo.jpg', 360, 375, 2)).toBe('/fixtures/story-photo.jpg')
  })
})
