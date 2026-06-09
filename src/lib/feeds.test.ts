import { describe, it, expect } from 'vitest'
import { FEEDS } from './feeds'

describe('FEEDS', () => {
  it('has no duplicate URLs', () => {
    const urls = FEEDS.map((f) => f.url)
    const duplicates = [...new Set(urls.filter((u, i) => urls.indexOf(u) !== i))]
    expect(duplicates).toEqual([])
  })

  it('every feed has a name, http(s) url, region, and lang', () => {
    for (const f of FEEDS) {
      expect(f.name).toBeTruthy()
      expect(f.url).toMatch(/^https?:\/\//)
      expect(f.region).toBeTruthy()
      expect(f.lang).toBeTruthy()
    }
  })
})
