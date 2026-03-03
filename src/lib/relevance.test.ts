import { describe, it, expect } from 'vitest'
import { isRelevant } from './relevance'

describe('isRelevant', () => {
  it('passes non-English articles unconditionally', () => {
    expect(isRelevant('گزارش روز تهران', '', 'fa')).toBe(true)
    expect(isRelevant('طقس اليوم في بغداد', '', 'ar')).toBe(true)
  })

  it('passes articles with direct conflict keywords', () => {
    expect(isRelevant('US airstrike kills 12 in Yemen', '', 'en')).toBe(true)
    expect(isRelevant('Israeli troops advance on Gaza', '', 'en')).toBe(true)
    expect(isRelevant('Russia fires missiles at Kyiv', '', 'en')).toBe(true)
  })

  it('passes articles with actor keywords', () => {
    expect(isRelevant('Iran warns of retaliation', '', 'en')).toBe(true)
    expect(isRelevant('Hezbollah launches rockets', '', 'en')).toBe(true)
    expect(isRelevant('Hamas releases statement', '', 'en')).toBe(true)
    expect(isRelevant('Houthis target Red Sea ship', '', 'en')).toBe(true)
  })

  it('passes articles with phrase keywords', () => {
    expect(isRelevant('North Korea tests ballistic missile', '', 'en')).toBe(true)
    expect(isRelevant('Tensions rise over Taiwan Strait', '', 'en')).toBe(true)
    expect(isRelevant('Regime change feared after coup', '', 'en')).toBe(true)
  })

  it('passes articles where keyword appears in summary not title', () => {
    expect(isRelevant('World leaders meet', 'Talks focus on Ukraine ceasefire', 'en')).toBe(true)
  })

  it('filters out irrelevant articles', () => {
    expect(isRelevant("Mexican drug lord 'El Mencho' buried in golden coffin", 'Nemesio Oseguera led the feared Jalisco New Generation Cartel', 'en')).toBe(false)
    expect(isRelevant('In Japan, support for the death penalty remains high', 'Japan is one of the few countries that still use the death penalty', 'en')).toBe(false)
    expect(isRelevant('Kim Jong Un fuels succession buzz with daughter leather jacket', 'Speculation is growing that his daughter may be named successor', 'en')).toBe(false)
    expect(isRelevant('Top 10 restaurants in Tokyo', '', 'en')).toBe(false)
    expect(isRelevant('New study links coffee to longevity', '', 'en')).toBe(false)
  })
})
