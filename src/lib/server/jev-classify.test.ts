import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const answer = (p: number) =>
  new Response(JSON.stringify({ answers: { relevant: { noul: p }, topic: { choice: 'x', confidence: 1 } }, usage: { input_tokens: 900 } }))

const art = (title: string) => ({ guid: title, title, summary: null, source_lang: 'en' })

describe('partitionByJev', () => {
  it('routes by band, and sends failures and the uncertain band on to the LLM', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { partitionByJev } = await import('./jev-classify')
    const byTitle: Record<string, () => Response> = {
      yes: () => answer(0.97),
      no: () => answer(0.03),
      maybe: () => answer(0.55),
      broken: () => new Response('nope', { status: 500 }),
    }
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const title = JSON.parse(String(init.body)).state.article.title as string
      return Promise.resolve(byTitle[title]())
    }))

    const part = await partitionByJev(['yes', 'no', 'maybe', 'broken'].map(art), { auditRate: 0, random: () => 0.99 })

    expect(part.accept.map((a) => a.title)).toEqual(['yes'])
    expect(part.reject.map((a) => a.title)).toEqual(['no'])
    expect(part.uncertain.map((a) => a.title).sort()).toEqual(['broken', 'maybe'])
    expect(part.failed).toBe(1)
    expect(part.inputTokens).toBe(2700)
  })

  it('audits confident verdicts by handing them to the LLM, never the uncertain ones', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { partitionByJev } = await import('./jev-classify')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer(0.99))))

    const part = await partitionByJev([art('a')], { auditRate: 1, random: () => 0 })

    expect(part.accept).toEqual([])
    expect(part.uncertain.map((a) => a.title)).toEqual(['a'])
    expect(part.audit.get(part.uncertain[0])).toBe('accept')
  })

  it('sends only the article to Jev — title, trimmed summary, language', async () => {
    vi.resetModules()
    const { jevState } = await import('./jev')
    expect(jevState({ title: 'T', summary: '  a\n b  ', source_lang: 'fa' })).toEqual({ article: { title: 'T', summary: 'a b', language: 'fa' } })
    expect(jevState({ title: 'T', summary: null, source_lang: 'fa' })).toEqual({ article: { title: 'T', language: 'fa' } })
  })
})
