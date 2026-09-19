import { describe, it, expect } from 'vitest'
import { buildActorSeries } from './trends'

const now = Date.parse('2026-09-19T15:00:00Z')

describe('buildActorSeries', () => {
  it('fills missing days with zeros so the window is dense and ends today (UTC)', () => {
    const [s] = buildActorSeries([{ actor: 'iran', day: '2026-09-18', stories: 5, major: 2 }], 7, now)
    expect(s.days.map((d) => d.day)).toEqual(['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'])
    expect(s.days.map((d) => d.stories)).toEqual([0, 0, 0, 0, 0, 5, 0])
    expect(s.peak).toBe(5)
  })

  it('compares this week with the week before', () => {
    const rows = [
      { actor: 'russia', day: '2026-09-19', stories: 9, major: 4 },
      { actor: 'russia', day: '2026-09-13', stories: 3, major: 1 }, // 7 days ago → this week's window
      { actor: 'russia', day: '2026-09-12', stories: 6, major: 3 }, // → the week before
    ]
    const [s] = buildActorSeries(rows, 30, now)
    expect(s.major7).toBe(5)
    expect(s.majorPrev7).toBe(3)
    expect(s.storiesTotal).toBe(18)
  })

  it('orders by this week’s major events, drops empty and unknown actors', () => {
    const out = buildActorSeries(
      [
        { actor: 'china', day: '2026-09-19', stories: 20, major: 1 },
        { actor: 'israel', day: '2026-09-19', stories: 4, major: 3 },
        { actor: 'not_an_actor', day: '2026-09-19', stories: 99, major: 99 },
        { actor: 'taiwan', day: '2026-07-01', stories: 5, major: 5 }, // outside the window
      ],
      30,
      now,
    )
    expect(out.map((s) => s.actor)).toEqual(['israel', 'china'])
  })
})
