import { describe, it, expect, afterEach } from 'vitest'
import { load, save, SAVED } from './saved'

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
  else delete (globalThis as { localStorage?: Storage }).localStorage
})

describe('saved', () => {
  it('reads and writes under the registered key', () => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    })
    save('lastVisit', '123')
    expect(store.get(SAVED.lastVisit)).toBe('123')
    expect(load('lastVisit')).toBe('123')
  })

  it('fails quietly when the browser refuses storage', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
    expect(load('readingLang')).toBeNull()
    expect(() => save('readingLang', 'fr')).not.toThrow()
  })
})
