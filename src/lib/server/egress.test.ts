import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { egress, meteredFetch } from './egress'
import { timed, type RunStats } from './pipeline/stats'

beforeEach(() => {
  egress.bytes = 0
  egress.requests = 0
})
afterEach(() => vi.unstubAllGlobals())

describe('meteredFetch', () => {
  it('counts the body as it is read, and hands it on unchanged', async () => {
    const body = JSON.stringify([{ id: 'a', title: 'هشدار سونامی پس از وقوع زمین‌لرزه' }])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-range': '0-0/1' } })))
    const res = await meteredFetch('https://example.supabase.co/rest/v1/articles')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-range')).toBe('0-0/1')
    expect(await res.json()).toEqual(JSON.parse(body))
    // Bytes, not characters: a Persian headline is two bytes a letter.
    expect(egress).toEqual({ bytes: Buffer.byteLength(body), requests: 1 })
  })

  it('passes an answer with no body through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    const res = await meteredFetch('https://example.supabase.co/rest/v1/rpc/settle_ai', { method: 'POST' })
    expect(res.status).toBe(204)
    expect(egress).toEqual({ bytes: 0, requests: 1 })
  })
})

describe('timed', () => {
  it('records what each stage read, adding up a stage that runs twice', async () => {
    const stats: RunStats = {}
    const reads = (n: number) => async () => void (egress.bytes += n)
    await timed(stats, 'roster', reads(56 * 1024))
    await timed(stats, 'fetch', reads(0))
    await timed(stats, 'cluster', reads(1024))
    await timed(stats, 'cluster', reads(512))
    expect(stats.egress?.stages).toEqual({ roster: 56, cluster: 1.5 })
    expect(Object.keys(stats.timings ?? {})).toEqual(['roster', 'fetch', 'cluster'])
  })

  it('records a stage that failed, with what it read before failing', async () => {
    const stats: RunStats = {}
    await expect(timed(stats, 'trending', async () => { egress.bytes += 2048; throw new Error('boom') })).rejects.toThrow('boom')
    expect(stats.egress?.stages).toEqual({ trending: 2 })
  })
})
