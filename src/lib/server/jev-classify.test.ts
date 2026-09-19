import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const answer = (p: number) =>
  new Response(JSON.stringify({ answers: { relevant: { noul: p }, topic: { choice: 'x', confidence: 1 } }, usage: { input_tokens: 900 } }))

const art = (title: string) => ({ guid: title, title, summary: null, source_lang: 'en' })

function stubJev(byTitle: Record<string, () => Response>) {
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
    Promise.resolve(byTitle[JSON.parse(String(init.body)).state.article.title as string]())))
}

describe('partitionByJev', () => {
  it('gives every article a final verdict at the threshold, counting the borderline ones', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { partitionByJev } = await import('./jev-classify')
    stubJev({ yes: () => answer(0.97), no: () => answer(0.03), leanYes: () => answer(0.55), leanNo: () => answer(0.45) })

    const part = await partitionByJev(['yes', 'no', 'leanYes', 'leanNo'].map(art))

    expect(part.accept.map((a) => a.title).sort()).toEqual(['leanYes', 'yes'])
    expect(part.reject.map((a) => a.title).sort()).toEqual(['leanNo', 'no'])
    expect(part.borderline).toBe(2)
    expect(part.unjudged).toEqual([])
    expect(part.inputTokens).toBe(3600)
  })

  it('never guesses: a failed call leaves the article unjudged, for the next run', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { partitionByJev } = await import('./jev-classify')
    stubJev({ yes: () => answer(0.9), broken: () => new Response('nope', { status: 500 }) })

    const part = await partitionByJev(['yes', 'broken'].map(art))

    expect(part.accept.map((a) => a.title)).toEqual(['yes'])
    expect(part.reject).toEqual([])
    expect(part.unjudged.map((a) => a.title)).toEqual(['broken'])
    expect(part.failed).toBe(1)
  })

  it('stops asking once the run is out of time, without a request', async () => {
    vi.resetModules()
    vi.stubEnv('TYPESAFE_API_KEY', 'test')
    const { partitionByJev } = await import('./jev-classify')
    const fetchMock = vi.fn(() => Promise.resolve(answer(0.9)))
    vi.stubGlobal('fetch', fetchMock)

    const part = await partitionByJev(['a', 'b'].map(art), { deadlineMs: Date.now() - 1 })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(part.unjudged).toHaveLength(2)
    expect(part.failed).toBe(0)
  })

  it('sends only the article to Jev — title, trimmed summary, language', async () => {
    vi.resetModules()
    const { jevState } = await import('./jev')
    expect(jevState({ title: 'T', summary: '  a\n b  ', source_lang: 'fa' })).toEqual({ article: { title: 'T', summary: 'a b', language: 'fa' } })
    expect(jevState({ title: 'T', summary: null, source_lang: 'fa' })).toEqual({ article: { title: 'T', language: 'fa' } })
  })
})
