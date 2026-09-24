import { describe, it, expect, vi } from 'vitest'
import webpush from 'web-push'

vi.mock('../supabase', () => ({ supabaseAdmin: {} }))
vi.mock('../jev', () => ({ callJev: vi.fn() }))

const { candidates, payload } = await import('./alerts')
const { VAPID_PUBLIC_KEY } = await import('../../vapid')

type M = Parameters<typeof candidates>[0][number]
let n = 0
const member = (story: string, o: Partial<M> = {}): M => ({
  story_id: story, title: `t${++n}`, summary: null, source_name: `S${n}`, source_region: `R${n % 4}`, source_lang: 'ru',
  published_at: '2026-09-24T06:00:00Z', severity: 0.3, opinion: 0.05, retrospective: 0.02, ...o,
})

describe('candidates', () => {
  it('needs 5 outlets, 3 regions and a news report at the top of the severity scale', () => {
    const big = [member('a', { severity: 0.96, title: 'Test at the nuclear site' }), ...Array.from({ length: 4 }, () => member('a'))]
    big[3].source_lang = 'en'
    big[3].title = 'Seventh nuclear test, officials say'
    big[3].severity = 0.9
    const out = candidates(big)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ storyId: 'a', outlets: 5 })
    // Told in English when a report is.
    expect(out[0].headline).toBe('Seventh nuclear test, officials say')
  })

  it('leaves out small stories, looks back and analysis', () => {
    expect(candidates([member('b', { severity: 0.96 }), member('b'), member('b'), member('b')])).toEqual([])
    const lookBack = [member('c', { severity: 0.99, retrospective: 0.98 }), ...Array.from({ length: 4 }, () => member('c'))]
    expect(candidates(lookBack)).toEqual([])
    const analysis = [member('d', { severity: 0.99, opinion: 0.8 }), ...Array.from({ length: 4 }, () => member('d'))]
    expect(candidates(analysis)).toEqual([])
  })
})

describe('the push', () => {
  it('opens the story it is about', () => {
    expect(JSON.parse(payload({ storyId: 's1', headline: 'War declared', outlets: 31 }))).toEqual({
      title: 'WW3Watch', body: 'War declared (31 outlets)', url: '/?story=s1', tag: 'alert-s1',
    })
  })

  it('encrypts and signs for a real subscription with the site key', () => {
    // A browser-shaped subscription (P-256 key, 16-byte secret) and a throwaway
    // private key: web-push builds the exact request it would send.
    const { privateKey } = webpush.generateVAPIDKeys()
    const ecdh = require('node:crypto').createECDH('prime256v1')
    ecdh.generateKeys()
    const sub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: ecdh.getPublicKey('base64url'), auth: require('node:crypto').randomBytes(16).toString('base64url') },
    }
    const req = webpush.generateRequestDetails(sub, payload({ storyId: 's1', headline: 'War declared', outlets: 31 }), {
      vapidDetails: { subject: 'https://ww3watch.org', publicKey: VAPID_PUBLIC_KEY, privateKey },
      TTL: 3600, urgency: 'high',
    })
    expect(req.method).toBe('POST')
    expect(req.headers.Urgency).toBe('high')
    expect(req.headers.Authorization).toMatch(/^vapid t=.+, k=/)
    expect(req.headers['Content-Encoding']).toBe('aes128gcm')
  })
})
