// What a reader is told about a sensor reading set against a story
// (src/lib/server/pipeline/evidence.ts). Plain statements of what the sensor
// saw, where and when relative to the first report. Never "confirmed": a fire
// near a reported strike is evidence, not proof, and the reader can follow the
// link to the reading itself.

export type EvidenceKind = 'fire' | 'quake' | 'outage'

export interface StoryEvidence {
  story_id: string
  kind: EvidenceKind
  at: string
  place: string
  distance_km: number | null
  value: number | null
  detail: { hours_from_first?: number; url?: string; type?: string; detections?: number } | null
}

/** "2 h after the first report", "40 min before", "within minutes of". */
export function relativeToFirst(hours: number | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return ''
  const mins = Math.round(Math.abs(hours) * 60)
  if (mins < 10) return 'within minutes of the first report'
  const span = mins < 60 ? `${mins} min` : `${Math.round(Math.abs(hours))} h`
  return `${span} ${hours < 0 ? 'before' : 'after'} the first report`
}

const km = (d: number | null) => (d == null ? '' : d < 1 ? 'under 1 km from' : `${Math.round(d)} km from`)

export function evidenceLine(e: StoryEvidence): { icon: 'satellite' | 'activity' | 'wifi-off'; text: string; href: string | null } {
  const when = relativeToFirst(e.detail?.hours_from_first)
  const tail = when ? `, ${when}` : ''
  const href = e.detail?.url ?? null
  if (e.kind === 'fire') return { icon: 'satellite', text: `NASA satellites saw a new fire ${km(e.distance_km)} ${e.place}${tail}`, href }
  if (e.kind === 'quake') {
    const type = e.detail?.type && e.detail.type !== 'earthquake' ? e.detail.type : 'tremor'
    const what = `${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${type}`
    const mag = e.value != null ? ` of magnitude ${e.value.toFixed(1)}` : ''
    return { icon: 'activity', text: `Seismometers recorded ${what}${mag} ${km(e.distance_km)} ${e.place}${tail}`, href }
  }
  return { icon: 'wifi-off', text: `Internet connectivity in ${e.place} dropped${tail}`, href }
}

export const EVIDENCE_SOURCE: Record<EvidenceKind, string> = {
  fire: 'NASA FIRMS',
  quake: 'USGS',
  outage: 'IODA, Georgia Tech',
}
