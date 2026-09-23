import { describe, it, expect } from 'vitest'
import { compareRuns, type RegressionRow } from './jev-regression'

const row = (title: string, relevant: number, severity = 0.2): RegressionRow => ({ title, lang: 'en', relevant, severity })
const many = (n: number) => Array.from({ length: n }, (_, i) => row(`t${i}`, 0.9))

describe('compareRuns', () => {
  it('passes when scores drift without changing any verdict', () => {
    const base = many(100)
    const now = base.map((r) => ({ ...r, relevant: r.relevant - 0.1 }))
    const report = compareRuns(base, now, 0.5)
    expect(report.relevanceFlips).toBe(0)
    expect(report.meanAbsRelevantDelta).toBeCloseTo(0.1)
    expect(report.ok).toBe(true)
  })

  it('fails when more than 3% of accept/reject verdicts flip', () => {
    const base = many(100)
    const now = base.map((r, i) => (i < 4 ? { ...r, relevant: 0.4 } : r))
    const report = compareRuns(base, now, 0.5)
    expect(report.relevanceFlips).toBe(4)
    expect(report.ok).toBe(false)
  })

  it('counts crossings of the major cut in both directions', () => {
    const base = [row('a', 0.9, 0.7), row('b', 0.9, 0.3), ...many(98)]
    const now = [row('a', 0.9, 0.4), row('b', 0.9, 0.6), ...many(98)]
    expect(compareRuns(base, now, 0.5).majorFlips).toBe(2)
  })

  it('refuses to call a mostly-unmatched comparison ok', () => {
    const report = compareRuns(many(100), many(50), 0.5)
    expect(report.n).toBe(50)
    expect(report.ok).toBe(false)
  })
})
