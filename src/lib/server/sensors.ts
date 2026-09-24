// Public sensor readings set against strike stories (pipeline/evidence.ts):
// NASA FIRMS satellite fire detections, USGS seismic events and IODA internet
// outages. All three are keyless. The parsers are pure; the stage does the I/O.

export type SensorKind = 'fire' | 'quake' | 'outage'

export interface SensorRow {
  kind: SensorKind
  source: string
  ext_id: string
  at: string
  lat: number | null
  lon: number | null
  cell: string | null
  value: number | null
  place: string | null
  detail: Record<string, unknown> | null
}

// Where the site's conflicts are fought (south, west, north, east). Fires
// elsewhere are never evidence, and this keeps a week of them to ~70,000 rows
// (measured on 2026-09-24: ~10,000 detections a day inside these boxes, most
// in the Middle East and western Russia). Central and southern Africa are left
// out on purpose: their dry-season burning is tens of thousands a day.
export const SENSOR_BOXES: ReadonlyArray<readonly [number, number, number, number]> = [
  [43, 14, 62, 62], // Russia west of the Urals, Ukraine, Belarus, Poland, the Baltics, Romania
  [12, 25, 43, 64], // Middle East, Türkiye, Iran, the Caucasus, Egypt
  [3, 21, 23, 52], // Sudan, South Sudan, Ethiopia, Eritrea, Somalia, Djibouti, southern Yemen
  [4, -12, 25, 24], // the Sahel: Mali, Niger, Burkina Faso, Chad, northern Nigeria
  [33, 124, 43, 131], // the Koreas
  [21, 118, 26, 123], // Taiwan and the strait
  [23, 60, 37, 78], // Pakistan, Afghanistan, northwest India, Kashmir
  [9, 92, 29, 102], // Myanmar
  [-5, -80, 13, -59], // Colombia, Venezuela
  [17, -75, 21, -71], // Haiti
]

export const inBoxes = (lat: number, lon: number): boolean =>
  SENSOR_BOXES.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e)

/** A fire's ~2 km square: 0.02 degrees of latitude and of longitude. */
export const fireCell = (lat: number, lon: number): string => `${Math.round(lat * 50)}:${Math.round(lon * 50)}`

/** The square and its eight neighbours: a flare that drifts one square over is still the same flare. */
export function cellAndNeighbours(cell: string): string[] {
  const [a, b] = cell.split(':').map(Number)
  const out: string[] = []
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(`${a + i}:${b + j}`)
  return out
}

// ── NASA FIRMS ───────────────────────────────────────────────────────────────
// VIIRS on three satellites, each passing over a place about twice a day. The
// public "active fire" text files need no key; each global day is ~4.5 MB.
export const FIRMS_SATELLITES = [
  ['N20', 'noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global'],
  ['N21', 'noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global'],
  ['NPP', 'suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global'],
] as const

export const firmsUrl = (path: string, span: '24h' | '7d'): string =>
  `https://firms.modaps.eosdis.nasa.gov/data/active_fire/${path}_${span}.csv`

/** Rows of a FIRMS VIIRS CSV inside the boxes; low-confidence detections dropped. */
export function parseFirmsCsv(csv: string, satellite: string): SensorRow[] {
  const lines = csv.split('\n')
  const header = (lines[0] ?? '').trim().split(',')
  const col = (name: string) => header.indexOf(name)
  const [iLat, iLon, iDate, iTime, iConf, iFrp] = ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp'].map(col)
  if ([iLat, iLon, iDate, iTime, iConf, iFrp].some((i) => i < 0)) throw new Error(`FIRMS: unexpected header ${lines[0]?.slice(0, 120)}`)
  const rows: SensorRow[] = []
  for (let n = 1; n < lines.length; n++) {
    const c = lines[n].split(',')
    if (c.length < header.length) continue
    const lat = Number(c[iLat])
    const lon = Number(c[iLon])
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inBoxes(lat, lon) || c[iConf] === 'low' || c[iConf] === 'l') continue
    const time = c[iTime].padStart(4, '0')
    const at = `${c[iDate]}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`
    if (Number.isNaN(Date.parse(at))) continue
    rows.push({
      kind: 'fire',
      source: `firms:${satellite}`,
      ext_id: `${c[iDate]}T${time}:${lat.toFixed(4)}:${lon.toFixed(4)}`,
      at,
      lat,
      lon,
      cell: fireCell(lat, lon),
      value: Number(c[iFrp]) || 0,
      place: null,
      detail: null,
    })
  }
  return rows
}

// ── USGS ─────────────────────────────────────────────────────────────────────
// Everything the USGS located in the past day (~200 KB). Kept: events inside
// the boxes, and anything the USGS itself labels other than an earthquake
// (explosion, quarry blast, nuclear explosion) wherever it is.
export const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson'

interface UsgsFeature {
  id: string
  properties: { mag: number | null; place: string | null; time: number; type: string; url: string }
  geometry: { coordinates: [number, number, number] }
}

export function parseUsgs(json: { features?: UsgsFeature[] }): SensorRow[] {
  const rows: SensorRow[] = []
  for (const f of json.features ?? []) {
    const [lon, lat, depth] = f.geometry?.coordinates ?? []
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(f.properties?.time)) continue
    const type = f.properties.type ?? 'earthquake'
    if (!inBoxes(lat, lon) && type === 'earthquake') continue
    rows.push({
      kind: 'quake',
      source: 'usgs',
      ext_id: f.id,
      at: new Date(f.properties.time).toISOString(),
      lat,
      lon,
      cell: null,
      value: f.properties.mag,
      place: f.properties.place,
      detail: { type, depth_km: depth, url: f.properties.url },
    })
  }
  return rows
}

// ── IODA ─────────────────────────────────────────────────────────────────────
// Georgia Tech's Internet Outage Detection and Analysis: country-level outage
// events from BGP, active probing and Google traffic, keyless.
export const iodaUrl = (fromS: number, untilS: number): string =>
  `https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=${fromS}&until=${untilS}&entityType=country&limit=1000`

interface IodaEvent {
  location: string
  location_name: string
  start: number
  duration: number
  score: number
  datasource: string
}

/** Outage events in the given countries (ISO 3166 alpha-2). */
export function parseIoda(json: { data?: IodaEvent[] }, countries: ReadonlySet<string>): SensorRow[] {
  const rows: SensorRow[] = []
  for (const e of json.data ?? []) {
    const code = e.location?.startsWith('country/') ? e.location.slice('country/'.length) : null
    if (!code || !countries.has(code) || !Number.isFinite(e.start)) continue
    rows.push({
      kind: 'outage',
      source: `ioda:${e.datasource}`,
      ext_id: `${code}:${e.start}`,
      at: new Date(e.start * 1000).toISOString(),
      lat: null,
      lon: null,
      cell: null,
      value: Number.isFinite(e.score) ? e.score : null,
      place: e.location_name ?? code,
      detail: { country: code, duration_s: e.duration },
    })
  }
  return rows
}

/** Kilometres between two points (haversine). */
export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p = Math.PI / 180
  const x = Math.sin(((lat2 - lat1) * p) / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(((lon2 - lon1) * p) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(x))
}
