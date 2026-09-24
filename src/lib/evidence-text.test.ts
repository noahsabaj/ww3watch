import { describe, it, expect } from 'vitest'
import { evidenceLine, relativeToFirst, type StoryEvidence } from './evidence-text'

const base = { story_id: 's', at: '2026-09-22T08:28:00Z', place: 'Samara' }

describe('evidenceLine', () => {
  it('says what the satellites saw, how far away and when', () => {
    const e: StoryEvidence = { ...base, kind: 'fire', distance_km: 13.7, value: 17.4, detail: { hours_from_first: 2.1, url: 'https://firms/x' } }
    expect(evidenceLine(e)).toEqual({ icon: 'satellite', text: 'NASA satellites saw a new fire 14 km from Samara, 2 h after the first report', href: 'https://firms/x' })
  })

  it('names a tremor or what the USGS called it, and an outage by country', () => {
    expect(evidenceLine({ ...base, kind: 'quake', distance_km: 5, value: 3.1, detail: { type: 'explosion' } }).text).toBe('Seismometers recorded an explosion of magnitude 3.1 5 km from Samara')
    const quake: StoryEvidence = { ...base, kind: 'quake', place: 'Kilju', distance_km: 3, value: 4.9, detail: { type: 'nuclear explosion', hours_from_first: -0.5 } }
    expect(evidenceLine(quake).text).toBe('Seismometers recorded a nuclear explosion of magnitude 4.9 3 km from Kilju, 30 min before the first report')
    const outage: StoryEvidence = { ...base, kind: 'outage', place: 'Yemen', distance_km: null, value: 5200, detail: { hours_from_first: 0.05 } }
    expect(evidenceLine(outage)).toMatchObject({ icon: 'wifi-off', text: 'Internet connectivity in Yemen dropped, within minutes of the first report', href: null })
  })
})

describe('relativeToFirst', () => {
  it('reads minutes, hours, before and after', () => {
    expect(relativeToFirst(-3.6)).toBe('4 h before the first report')
    expect(relativeToFirst(0.5)).toBe('30 min after the first report')
    expect(relativeToFirst(undefined)).toBe('')
  })
})
