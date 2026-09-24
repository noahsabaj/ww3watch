import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({ supabaseAdmin: {} }))
vi.mock('../jev', () => ({ callJev: vi.fn() }))

const { bestFire, isLatinScript, locateQuestions, NONE, FIRE } = await import('./evidence')
const { fireCell } = await import('../sensors')
const { placesIn } = await import('../gazetteer')

// Odesa, reported at 14:00: the port burned at 10:09 that morning (65 MW).
const odesa = {
  story_id: 's1', name: 'Odesa', country: 'UA', lat: 46.4775, lon: 30.7326,
  first_report_at: '2026-09-22T14:00:00Z', p_fire: 0.9, p_outage: 0.1, p_blast: 0.1,
}
const fire = (lat: number, lon: number, at: string, value: number) => ({ at, lat, lon, value, cell: fireCell(lat, lon) })
const port = [fire(46.5042, 30.6312, '2026-09-22T10:09:00Z', 64.89), fire(46.5050, 30.6330, '2026-09-22T10:09:00Z', 20)]

describe('bestFire', () => {
  it('matches a big new fire near the place before the first report', () => {
    const e = bestFire(odesa, 1_000_000, port, new Set())
    expect(e).toMatchObject({ at: '2026-09-22T10:09:00Z', value: 64.89, distance_km: 8.3 })
    expect(e?.detail).toMatchObject({ detections: 2, hours_from_first: -3.8 })
  })

  it('ignores a square that burned in the days before (a flare, a steelworks)', () => {
    expect(bestFire(odesa, 1_000_000, port, new Set([fireCell(46.5042, 30.6312)]))).toBeNull()
  })

  it('ignores a small fire, a far one, and one outside the hours around the report', () => {
    expect(bestFire(odesa, 1_000_000, [fire(46.5, 30.63, '2026-09-22T10:00:00Z', 3)], new Set())).toBeNull()
    expect(bestFire(odesa, 1_000_000, [fire(47.1, 30.7, '2026-09-22T10:00:00Z', 80)], new Set())).toBeNull()
    expect(bestFire(odesa, 1_000_000, [fire(46.5, 30.63, '2026-09-22T07:00:00Z', 80)], new Set())).toBeNull()
    expect(bestFire(odesa, 1_000_000, [fire(46.5, 30.63, '2026-09-23T03:00:00Z', 80)], new Set())).toBeNull()
  })

  it('takes one very big detection on its own', () => {
    expect(bestFire(odesa, 1_000_000, [fire(46.5, 30.63, '2026-09-22T18:00:00Z', FIRE.bigFrp)], new Set())).not.toBeNull()
    // Outside a smaller city's 20 km, inside a million-strong one's 25.
    const at22km = fire(46.6800, 30.7326, '2026-09-22T12:00:00Z', 80)
    expect(bestFire(odesa, 900_000, [at22km], new Set())).toBeNull()
    expect(bestFire(odesa, 1_000_000, [at22km], new Set())).not.toBeNull()
  })
})

describe('locating', () => {
  it('tells Latin-script reports from others', () => {
    expect(isLatinScript('Russian forces strike logistics hubs in Odesa')).toBe(true)
    expect(isLatinScript('Ворог атакував Одесу')).toBe(false)
  })

  it('asks where among the places found, with a way out, and the three causes', () => {
    const q = locateQuestions(placesIn('Russia strikes Odesa, officials in Kyiv say')) as Record<string, { type: string; criteria?: Record<string, unknown> }>
    expect(Object.keys(q.where.criteria!)).toEqual(['Kyiv, Ukraine', 'Odesa, Ukraine', NONE])
    expect([q.fire.type, q.outage.type, q.blast.type]).toEqual(['noul', 'noul', 'noul'])
  })
})
