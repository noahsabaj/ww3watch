import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ALL_REGIONS, REGIONS, REGION_COLORS, REGION_BORDER } from './types'

describe('regions', () => {
  // The README advertised "16 region/perspective buckets" while REGIONS held 14,
  // and nothing could catch the drift because the claim lived only in prose.
  // Read the actual sentence so either side moving fails the build — a
  // user-facing count is an assertion, not a description.
  it('matches the bucket count the README advertises', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
    const claim = readme.match(/(\d+) region\/perspective buckets/)
    expect(claim, 'README no longer states a region/perspective bucket count').not.toBeNull()
    expect(Number(claim![1])).toBe(ALL_REGIONS.length)
  })

  it('derives every lookup from REGIONS, so a new region needs one edit', () => {
    const keys = Object.keys(REGIONS)
    expect(ALL_REGIONS).toEqual(keys)
    expect(Object.keys(REGION_COLORS)).toEqual(keys)
    expect(Object.keys(REGION_BORDER)).toEqual(keys)
  })

  // Tailwind v4 scans source files for complete class strings; a region colour
  // assembled at runtime would never reach the generated stylesheet, and the
  // badge would silently render unstyled.
  it('states colour and border classes as whole literals', () => {
    for (const [region, v] of Object.entries(REGIONS)) {
      expect(v.color, region).toMatch(/^bg-[a-z]+-\d{3} text-\w+$/)
      expect(v.border, region).toMatch(/^border-[a-z]+-\d{3}$/)
    }
  })
})
