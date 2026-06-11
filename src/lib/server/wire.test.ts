import { describe, it, expect } from 'vitest'
import { normalizeSummary, bodyHash } from './wire'

describe('normalizeSummary', () => {
  it('strips punctuation and collapses whitespace', () => {
    expect(normalizeSummary('  Wire,   COPY — here! ')).toBe('wire copy here')
  })

  it('lowercases', () => {
    expect(normalizeSummary('NATO Summit')).toBe('nato summit')
  })

  it('keeps non-Latin scripts', () => {
    expect(normalizeSummary('حمله به تهران!')).toBe('حمله به تهران')
  })
})

describe('bodyHash', () => {
  const WIRE =
    'TEHRAN - Iranian state media reported new explosions near the Natanz facility on Wednesday, according to officials.'

  it('matches across outlets reprinting the same copy with formatting tweaks', () => {
    const a = bodyHash(WIRE)
    const b = bodyHash(
      'TEHRAN -- Iranian state media reported new explosions near the "Natanz" facility, on Wednesday according to officials',
    )
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it('differs for different text', () => {
    expect(bodyHash(WIRE)).not.toBe(bodyHash(WIRE + ' Additional independent reporting follows here.'))
  })

  it('returns null for absent or short summaries', () => {
    expect(bodyHash(null)).toBeNull()
    expect(bodyHash('')).toBeNull()
    expect(bodyHash('Too short.')).toBeNull()
  })
})
