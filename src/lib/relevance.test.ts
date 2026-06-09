import { describe, it, expect } from 'vitest'
import { isRelevant } from './relevance'

// English-keyword heuristic (LLM-failure fallback only; non-English never
// reaches it — classify.ts defers those to the next run's LLM verdict).
describe('isRelevant', () => {
  it('passes articles with direct conflict keywords', () => {
    expect(isRelevant('US airstrike kills 12 in Yemen', '')).toBe(true)
    expect(isRelevant('Israeli troops advance on Gaza', '')).toBe(true)
    expect(isRelevant('Russia fires missiles at Kyiv', '')).toBe(true)
  })

  it('passes articles with actor keywords', () => {
    expect(isRelevant('Iran warns of retaliation', '')).toBe(true)
    expect(isRelevant('Hezbollah launches rockets', '')).toBe(true)
    expect(isRelevant('Hamas releases statement', '')).toBe(true)
    expect(isRelevant('Houthis target Red Sea ship', '')).toBe(true)
  })

  it('passes articles with phrase keywords', () => {
    expect(isRelevant('North Korea tests ballistic missile', '')).toBe(true)
    expect(isRelevant('Tensions rise over Taiwan Strait', '')).toBe(true)
    expect(isRelevant('Regime change feared after coup', '')).toBe(true)
  })

  it('passes articles where keyword appears in summary not title', () => {
    expect(isRelevant('World leaders meet', 'Talks focus on Ukraine ceasefire')).toBe(true)
  })

  it('filters out irrelevant articles', () => {
    expect(isRelevant("Mexican drug lord 'El Mencho' buried in golden coffin", 'Nemesio Oseguera led the feared Jalisco New Generation Cartel')).toBe(false)
    expect(isRelevant('In Japan, support for the death penalty remains high', 'Japan is one of the few countries that still use the death penalty')).toBe(false)
    expect(isRelevant('Kim Jong Un fuels succession buzz with daughter leather jacket', 'Speculation is growing that his daughter may be named successor')).toBe(false)
    expect(isRelevant('Top 10 restaurants in Tokyo', '')).toBe(false)
    expect(isRelevant('New study links coffee to longevity', '')).toBe(false)
  })
})
