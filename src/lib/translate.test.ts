import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted above imports; the mock's state must be hoisted with it.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }))

import {
  translateHeadline,
  cachedHeadline,
  failureReason,
  failureLabel,
  TranslateError,
  _resetHeadlineCache,
} from './translate'

const fa = {
  url: 'https://example.test/a/1',
  title: 'سلام دنیا',
  summary: 'این یک آزمایش است.',
  source_lang: 'fa',
}

beforeEach(() => {
  invoke.mockReset()
  _resetHeadlineCache()
})

describe('translateHeadline', () => {
  it('sends the plain (title + content) shape and maps content back to summary', async () => {
    invoke.mockResolvedValue({ data: { title: 'Hello world', content: 'This is a test.' }, error: null })
    const out = await translateHeadline(fa, 'en')
    expect(out).toEqual({ title: 'Hello world', summary: 'This is a test.' })
    expect(invoke).toHaveBeenCalledWith('translate', {
      body: { title: fa.title, content: fa.summary, lang: 'fa', url: fa.url, target: 'en' },
    })
  })

  it('caches per url + target so a remounted card never re-requests', async () => {
    invoke.mockResolvedValue({ data: { title: 'Hello world', content: 'This is a test.' }, error: null })
    await translateHeadline(fa, 'en')
    await translateHeadline(fa, 'en')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(cachedHeadline(fa, 'en')).toEqual({ title: 'Hello world', summary: 'This is a test.' })
    // A different reading language is a different translation.
    expect(cachedHeadline(fa, 'ru')).toBeUndefined()
    await translateHeadline(fa, 'ru')
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('dedupes concurrent requests for the same card', async () => {
    let resolve!: (v: unknown) => void
    invoke.mockReturnValue(new Promise((r) => (resolve = r)))
    const a = translateHeadline(fa, 'en')
    const b = translateHeadline(fa, 'en')
    expect(invoke).toHaveBeenCalledTimes(1)
    resolve({ data: { title: 'Hello world', content: 'This is a test.' }, error: null })
    expect(await a).toEqual(await b)
  })

  it('short-circuits when the article is already in the reading language', async () => {
    const out = await translateHeadline({ ...fa, source_lang: 'en' }, 'en')
    expect(out).toEqual({ title: fa.title, summary: fa.summary })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps summary null for an article that had none', async () => {
    invoke.mockResolvedValue({ data: { title: 'Hello world', content: '' }, error: null })
    const out = await translateHeadline({ ...fa, summary: null }, 'en')
    expect(out.summary).toBeNull()
    expect(invoke.mock.calls[0][1].body.content).toBe('')
  })

  it('surfaces a 429 as rate_limited and everything else as failed, and caches neither', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 429 } } })
    await expect(translateHeadline(fa, 'en')).rejects.toMatchObject({ reason: 'rate_limited' })
    invoke.mockResolvedValueOnce({ data: null, error: { context: { status: 502 } } })
    await expect(translateHeadline(fa, 'en')).rejects.toMatchObject({ reason: 'failed' })
    // A malformed success body is a failure too — never render undefined.
    invoke.mockResolvedValueOnce({ data: { title: 'x' }, error: null })
    await expect(translateHeadline(fa, 'en')).rejects.toBeInstanceOf(TranslateError)
    expect(cachedHeadline(fa, 'en')).toBeUndefined()
    // ...and a failed attempt doesn't poison the next one.
    invoke.mockResolvedValueOnce({ data: { title: 'Hello world', content: 'ok' }, error: null })
    await expect(translateHeadline(fa, 'en')).resolves.toMatchObject({ title: 'Hello world' })
  })
})

describe('failureReason / failureLabel', () => {
  it('reads the status off a supabase FunctionsHttpError-shaped error', () => {
    expect(failureReason({ context: { status: 429 } })).toBe('rate_limited')
    expect(failureReason({ context: { status: 502 } })).toBe('failed')
    expect(failureReason(new Error('network'))).toBe('failed')
    expect(failureReason(null)).toBe('failed')
    expect(failureReason(new TranslateError('rate_limited'))).toBe('rate_limited')
  })
  it('only promises a retry when retrying can work', () => {
    expect(failureLabel('failed')).toMatch(/tap to retry/)
    expect(failureLabel('rate_limited')).toMatch(/later/)
    expect(failureLabel('rate_limited')).not.toMatch(/retry/)
  })
})
