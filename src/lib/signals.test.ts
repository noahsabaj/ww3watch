import { describe, it, expect } from 'vitest'
import { emptySignalFilter, matchesSignals, signalFilterActive } from './signals'

const strike = { topic: 'armed_conflict' as const, severity: 0.67, claim: 0.03, opinion: 0.03, actors: ['russia' as const, 'ukraine' as const] }
const threat = { topic: 'nuclear_or_missiles' as const, severity: 0.11, claim: 0.97, opinion: 0.08, actors: ['iran' as const, 'israel' as const] }
const oped = { topic: 'other' as const, severity: 0, claim: 0.37, opinion: 0.96, actors: [] }
const unannotated = {}

describe('matchesSignals', () => {
  it('passes everything when no filter is set', () => {
    const f = emptySignalFilter()
    expect(signalFilterActive(f)).toBe(false)
    expect([strike, threat, oped, unannotated].every((a) => matchesSignals(a, f))).toBe(true)
  })

  it('major-only keeps significant events and drops statements and the un-annotated', () => {
    const f = { ...emptySignalFilter(), majorOnly: true }
    expect(matchesSignals(strike, f)).toBe(true)
    expect(matchesSignals(threat, f)).toBe(false)
    expect(matchesSignals(unannotated, f)).toBe(false)
  })

  it('hide filters never hide an article nothing is known about', () => {
    const f = { ...emptySignalFilter(), hideOpinion: true, hideClaims: true }
    expect(matchesSignals(oped, f)).toBe(false)
    expect(matchesSignals(threat, f)).toBe(false)
    expect(matchesSignals(strike, f)).toBe(true)
    expect(matchesSignals(unannotated, f)).toBe(true)
  })

  it('topics and actors narrow by inclusion; any one selected actor is enough', () => {
    expect(matchesSignals(strike, { ...emptySignalFilter(), topics: new Set(['armed_conflict']) })).toBe(true)
    expect(matchesSignals(threat, { ...emptySignalFilter(), topics: new Set(['armed_conflict']) })).toBe(false)
    expect(matchesSignals(threat, { ...emptySignalFilter(), actors: new Set(['iran', 'china']) })).toBe(true)
    expect(matchesSignals(strike, { ...emptySignalFilter(), actors: new Set(['iran']) })).toBe(false)
    expect(matchesSignals(unannotated, { ...emptySignalFilter(), actors: new Set(['iran']) })).toBe(false)
  })
})
