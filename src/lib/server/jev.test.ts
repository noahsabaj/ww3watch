import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { settled } = vi.hoisted(() => ({ settled: [] as Array<number | undefined> }))
vi.mock('./ai-budget', () => ({
  reserveClassification: async () => async (tokens?: number) => { settled.push(tokens) },
}))

beforeEach(async () => {
  settled.length = 0
  vi.stubEnv('TYPESAFE_API_KEY', 'test')
  ;(await import('./jev')).resetJevBreaker()
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

describe('callJev breaker', () => {
  const billing = '{"detail":{"error_type":"billing_error","message":"no available TypeSafe API credits"}}'
  const always = (make: () => Response) => {
    const fetch = vi.fn(async () => make())
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it.each([401, 402, 403])('opens on one %i: later calls are not sent, reserved, or billed', async (status) => {
    const { callJev, jevOutage, assertJevServed } = await import('./jev')
    const fetch = always(() => new Response(billing, { status }))
    await expect(callJev({}, {})).rejects.toThrow(`jev ${status}`)
    await expect(callJev({}, {})).rejects.toThrow('not sent')
    await expect(callJev({}, {})).rejects.toThrow('not sent')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(settled).toEqual([0])
    expect(jevOutage()).toEqual({ status, detail: billing, account: true, skipped: 2 })
    expect(assertJevServed).toThrow(`TypeSafe refused Jev with ${status} (2 calls not sent): ${billing}`)
  })

  it('opens after three calls in a row outlast their 429 retries, and does not fail the run', async () => {
    const { callJev, jevOutage, assertJevServed } = await import('./jev')
    always(() => new Response('slow down', { status: 429, headers: { 'retry-after': '0.001' } }))
    for (let i = 0; i < 3; i++) await expect(callJev({}, {})).rejects.toThrow('jev 429')
    await expect(callJev({}, {})).rejects.toThrow('not sent')
    expect(jevOutage()).toMatchObject({ status: 429, account: false, skipped: 1 })
    expect(assertJevServed).not.toThrow()
  })

  it('a success between overloads starts the count again', async () => {
    const { callJev, jevOutage } = await import('./jev')
    const limited = () => new Response('slow down', { status: 529, headers: { 'retry-after': '0.001' } })
    always(limited)
    for (let i = 0; i < 2; i++) await expect(callJev({}, {})).rejects.toThrow('jev 529')
    stub(ok)
    await callJev({}, {})
    always(limited)
    for (let i = 0; i < 2; i++) await expect(callJev({}, {})).rejects.toThrow('jev 529')
    expect(jevOutage()).toBeNull()
  })

  it('stays closed on errors that may pass: a 5xx or a network failure', async () => {
    const { callJev, jevOutage } = await import('./jev')
    always(() => new Response('boom', { status: 500 }))
    for (let i = 0; i < 5; i++) await expect(callJev({}, {})).rejects.toThrow('jev 500')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    for (let i = 0; i < 5; i++) await expect(callJev({}, {})).rejects.toThrow('fetch failed')
    expect(jevOutage()).toBeNull()
  })
})
