import { describe, it, expect, beforeAll } from 'vitest'

const store = new Map<string, string>([['ww3-swiped', '1']])
beforeAll(() => {
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  } as Storage
})

describe('tips', () => {
  it('shows nothing until loaded, then only what this reader has not learned', async () => {
    const { tips } = await import('./tips.svelte')
    expect(tips.shown('swipe')).toBe(false)
    expect(tips.shown('read-story')).toBe(false)
    tips.load()
    expect(tips.shown('swipe')).toBe(false)
    expect(tips.shown('read-story')).toBe(true)
  })

  it('retires a tip for good once done, under the key it first shipped with', async () => {
    const { tips } = await import('./tips.svelte')
    tips.done('read-story')
    expect(tips.shown('read-story')).toBe(false)
    expect(store.get('ww3-read-tip-seen')).toBe('1')
  })
})
