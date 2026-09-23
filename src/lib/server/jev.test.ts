import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { settled } = vi.hoisted(() => ({ settled: [] as Array<number | undefined> }))
vi.mock('./ai-budget', () => ({
  reserveClassification: async () => async (tokens?: number) => { settled.push(tokens) },
}))

beforeEach(() => {
  settled.length = 0
  vi.stubEnv('TYPESAFE_API_KEY', 'test')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const ok = () => new Response(JSON.stringify({ answers: { relevant: { noul: 0.9 } }, usage: { input_tokens: 900 } }))
const stub = (...responses: Array<() => Response | Promise<Response>>) =>
  vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!()))

describe('callJev settlement', () => {
  it('settles a success at the tokens TypeSafe reports', async () => {
    const { callJev } = await import('./jev')
    stub(ok)
    await callJev({}, {})
    expect(settled).toEqual([900])
  })

  it.each([401, 402, 403])('settles a %i refusal at zero: TypeSafe did no work and bills nothing', async (status) => {
    const { callJev } = await import('./jev')
    stub(() => new Response('{"error":"billing"}', { status }))
    await expect(callJev({}, {})).rejects.toThrow(`jev ${status}`)
    expect(settled).toEqual([0])
  })

  it('settles each rate-limited attempt at zero, and the retry that works at its tokens', async () => {
    const { callJev } = await import('./jev')
    stub(() => new Response('slow down', { status: 429, headers: { 'retry-after': '0.01' } }), ok)
    await callJev({}, {})
    expect(settled).toEqual([0, 900])
  })

  it('keeps the worst case when the call may have run: a 5xx, or no response at all', async () => {
    const { callJev } = await import('./jev')
    stub(() => new Response('boom', { status: 500 }))
    await expect(callJev({}, {})).rejects.toThrow('jev 500')
    stub(() => Promise.reject(new TypeError('fetch failed')))
    await expect(callJev({}, {})).rejects.toThrow('fetch failed')
    expect(settled).toEqual([undefined, undefined])
  })
})
