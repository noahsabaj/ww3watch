import { describe, expect, it } from 'vitest'
import { parseHomeView } from './home-view'

describe('parseHomeView', () => {
  it('defaults to Signal', () => {
    expect(parseHomeView('', null)).toBe('signal')
    expect(parseHomeView('utm_source=x', 'nope')).toBe('signal')
  })

  it('lets the query string override storage', () => {
    expect(parseHomeView('?view=list', 'signal')).toBe('list')
    expect(parseHomeView('view=signal', 'list')).toBe('signal')
  })

  it('remembers the last choice when the URL is silent', () => {
    expect(parseHomeView('', 'list')).toBe('list')
    expect(parseHomeView('?article=abc', 'list')).toBe('list')
  })
})
