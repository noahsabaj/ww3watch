import { describe, expect, it } from 'vitest'
import { isLocalSupabase, productionWriteRefusal } from './write-guard'

const HOSTED = 'https://qusjbpknlduuklnfciws.supabase.co'

describe('productionWriteRefusal', () => {
  it('allows the local stack from anywhere', () => {
    expect(productionWriteRefusal('http://127.0.0.1:54321', {})).toBeNull()
    expect(productionWriteRefusal('http://localhost:54321', {})).toBeNull()
  })

  it('refuses the hosted project from a laptop', () => {
    expect(productionWriteRefusal(HOSTED, {})).toMatch(/staging:up/)
  })

  it('allows the hosted project from GitHub Actions or with the explicit override', () => {
    expect(productionWriteRefusal(HOSTED, { GITHUB_ACTIONS: 'true' })).toBeNull()
    expect(productionWriteRefusal(HOSTED, { WW3WATCH_ALLOW_PRODUCTION: '1' })).toBeNull()
  })

  it('does not treat look-alike values as the override', () => {
    expect(productionWriteRefusal(HOSTED, { WW3WATCH_ALLOW_PRODUCTION: 'true' })).not.toBeNull()
    expect(productionWriteRefusal(HOSTED, { GITHUB_ACTIONS: '1' })).not.toBeNull()
  })
})

describe('isLocalSupabase', () => {
  it('only matches loopback hosts', () => {
    expect(isLocalSupabase('http://[::1]:54321')).toBe(true)
    expect(isLocalSupabase('http://127.0.0.1.example.com')).toBe(false)
    expect(isLocalSupabase('not a url')).toBe(false)
  })
})
