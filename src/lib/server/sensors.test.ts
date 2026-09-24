import { describe, it, expect } from 'vitest'
import { cellAndNeighbours, fireCell, inBoxes, kmBetween, parseFirmsCsv, parseIoda, parseUsgs } from './sensors'

const HEADER = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight'

describe('parseFirmsCsv', () => {
  it('keeps confident detections inside the boxes, with their square', () => {
    const csv = [
      HEADER,
      '46.50418,30.63117,367,0.39,0.36,2026-09-22,1009,N20,nominal,2.0NRT,300,64.89,D', // Odesa port
      '46.50000,30.63000,300,0.39,0.36,2026-09-22,1009,N20,low,2.0NRT,290,1.2,D', // low confidence
      '-7.69697,34.59667,307.24,0.52,0.67,2026-09-23,0001,N20,nominal,2.0NRT,286,1.71,N', // Tanzania: outside
      '',
    ].join('\n')
    const rows = parseFirmsCsv(csv, 'N20')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'fire', source: 'firms:N20', at: '2026-09-22T10:09:00Z', value: 64.89, cell: fireCell(46.50418, 30.63117) })
    expect(rows[0].ext_id).toBe('2026-09-22T1009:46.5042:30.6312')
  })

  it('pads a three-digit time and refuses a changed header', () => {
    const rows = parseFirmsCsv(`${HEADER}\n55.634,37.832,330,0.4,0.4,2026-09-20,028,N21,high,2.0NRT,290,5.4,N`, 'N21')
    expect(rows[0].at).toBe('2026-09-20T00:28:00Z')
    expect(() => parseFirmsCsv('lat,lon\n1,2', 'N20')).toThrow(/header/)
  })
})

describe('parseUsgs', () => {
  const feature = (id: string, lon: number, lat: number, type = 'earthquake') => ({
    id, properties: { mag: 4.9, place: 'somewhere', time: Date.parse('2026-09-18T03:30:00Z'), type, url: `https://usgs/${id}` },
    geometry: { coordinates: [lon, lat, 1] as [number, number, number] },
  })

  it('keeps events in the boxes, and anything not an earthquake anywhere', () => {
    const rows = parseUsgs({ features: [feature('kp1', 129.08, 41.28), feature('us1', -116, 37), feature('us2', -116, 37, 'explosion')] })
    expect(rows.map((r) => r.ext_id)).toEqual(['kp1', 'us2'])
    expect(rows[0]).toMatchObject({ kind: 'quake', value: 4.9, at: '2026-09-18T03:30:00.000Z', detail: { type: 'earthquake', url: 'https://usgs/kp1' } })
  })
})

describe('parseIoda', () => {
  it('keeps outages in the countries asked about', () => {
    const json = { data: [
      { location: 'country/YE', location_name: 'Yemen', start: 1790139600, duration: 7200, score: 5200, datasource: 'bgp' },
      { location: 'country/PY', location_name: 'Paraguay', start: 1789497000, duration: 729026, score: 16552, datasource: 'bgp' },
    ] }
    const rows = parseIoda(json, new Set(['YE']))
    expect(rows).toEqual([expect.objectContaining({ kind: 'outage', source: 'ioda:bgp', place: 'Yemen', value: 5200, detail: { country: 'YE', duration_s: 7200 } })])
  })
})

describe('geometry', () => {
  it('boxes the conflicts, not the world', () => {
    expect(inBoxes(50.45, 30.52)).toBe(true) // Kyiv
    expect(inBoxes(15.35, 44.2)).toBe(true) // Sanaa
    expect(inBoxes(-7.7, 34.6)).toBe(false) // Tanzania
  })

  it('measures distance and neighbouring squares', () => {
    expect(kmBetween(46.4825, 30.7233, 46.5042, 30.6312)).toBeCloseTo(7.4, 0)
    expect(cellAndNeighbours('10:20')).toHaveLength(9)
    expect(cellAndNeighbours('10:20')).toContain('9:21')
  })
})
