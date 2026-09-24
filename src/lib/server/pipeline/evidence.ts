// Evidence from sensors for strike stories: where did it happen, and did a
// satellite, a seismometer or the internet notice? Three steps, each run:
//
//  1. Read the sensors (sensors.ts): NASA FIRMS fire detections hourly (a week
//     on the first read), USGS seismic events and IODA outages every 15
//     minutes. A week is kept in sensor_events.
//  2. Locate stories that report a significant current event. Place names in
//     their Latin-script reports (gazetteer.ts) are the candidates, and one Jev
//     request picks where it happened, or none, and asks whether it could start
//     a fire, cut power or internet, or shake the ground (story_places).
//  3. Match readings near the place and around the first report, and for fires
//     only new ones (nothing burned in that square in the days before). Each
//     match becomes the story's evidence (story_evidence), which the site shows.
//
// Measured on the week to 2026-09-24 before shipping. New fires matched the
// Odesa port strike (65 MW, 9 km away, 7 h before the first report), the
// Moscow refinery and the Deir ez-Zor depot blast. Without Jev's two checks, a
// Gaza City fire 22 km away "matched" every Gaza story and a Seoul fire matched
// a North Korean launch.
import { supabaseAdmin } from '../supabase'
import { callJev } from '../jev'
import { eventSeverity, MAJOR_SEVERITY, SIGNAL_YES } from '../../signals'
import { COUNTRY_NAMES, placeById, placeLabel, placesIn, type Place } from '../gazetteer'
import {
  FIRMS_SATELLITES, USGS_URL, cellAndNeighbours, firmsUrl, iodaUrl, kmBetween, parseFirmsCsv, parseIoda, parseUsgs,
  type SensorRow,
} from '../sensors'
import { mapPool } from '../pool'
import { bump, type RunStats } from './stats'

const H = 3600_000
const DAY = 24 * H
/** Stories whose first report is this recent are located and matched. */
const LOOKBACK_HOURS = 36
const LOCATE_CAP = 40
const RETRY_UNLOCATED_HOURS = 2
const LOCATE_CONCURRENCY = 6
const EVERY_MINUTES = { firms: 60, usgs: 15, ioda: 15 } as const
const KEEP_DAYS = 8
/** Jev's answer on the event's cause must reach this before a sensor is asked. */
const CAUSE_YES = 0.5
/** And its choice of place this. */
const PLACE_YES = 0.6

// A fire counts when it is close to the place (20 km, 25 for a city of a
// million) and seen from 6 h before the first report to 11 h after. The
// satellites pass about twice a day, so a fire is usually seen at the next
// pass after a strike, and a burning depot is still burning then. Over the
// week to 2026-09-24, every match further out or later than that was another
// fire (front-line shelling near Kramatorsk and Kherson, Dnipro and Kyiv fires
// 12-13 h after a daytime report), while the refinery fires in Samara (+2 h)
// and Moscow (+10 h) and the ballistic strike on Dnipro (-4 h) sat inside it. It must also
// be new, with nothing seen in its square or the next ones for 5 days before:
// refineries, gas flares and steelworks burn every night. And it must be big:
// at least two detections of 5 MW or more within 3 km, or one of 15 MW. A
// burning depot or port is tens of MW; a field fire a few.
export const FIRE = { radiusKm: 20, bigCityKm: 25, bigCity: 1_000_000, beforeH: 6, afterH: 11, quietDays: 5, minFrp: 5, minCount: 2, clusterKm: 3, bigFrp: 15 }
// Seismometers hear large blasts and nuclear tests near where they happened.
export const QUAKE = { radiusKm: 60, beforeH: 12, afterH: 6 }
// An outage in the same country as the event, starting around the first report.
export const OUTAGE = { beforeH: 6, afterH: 6 }

// ── 1. Sensors ───────────────────────────────────────────────────────────────

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { 'User-Agent': 'ww3watch.org sensor evidence' } })
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`)
  return res
}

async function store(rows: SensorRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await supabaseAdmin
      .from('sensor_events')
      .upsert(rows.slice(i, i + 1000) as never, { onConflict: 'source,ext_id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
  }
}

const COUNTRIES = new Set(Object.keys(COUNTRY_NAMES))
const STAT = { firms: 'sensors_fire', usgs: 'sensors_quake', ioda: 'sensors_outage' } as const

/** Read whichever sensors are due. True when any was read (new data to match). */
export async function readSensors(stats: RunStats, now = Date.now()): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('sensor_fetches').select('source, fetched_at')
  if (error) throw new Error(error.message)
  const last = new Map((data ?? []).map((r) => [r.source, Date.parse(r.fetched_at)]))
  const due = (s: keyof typeof EVERY_MINUTES) => (last.get(s) ?? 0) <= now - EVERY_MINUTES[s] * 60_000
  const reads: Array<[keyof typeof EVERY_MINUTES, () => Promise<SensorRow[]>]> = []
  if (due('firms')) {
    reads.push(['firms', async () => {
      // The first read takes the whole week, so a fire can be told new at once.
      const span = last.has('firms') ? '24h' : '7d'
      const files = await Promise.all(FIRMS_SATELLITES.map(async ([sat, path]) => parseFirmsCsv(await (await get(firmsUrl(path, span))).text(), sat)))
      return files.flat()
    }])
  }
  if (due('usgs')) reads.push(['usgs', async () => parseUsgs(await (await get(USGS_URL)).json())])
  if (due('ioda')) {
    const until = Math.floor(now / 1000)
    reads.push(['ioda', async () => parseIoda(await (await get(iodaUrl(until - 26 * 3600, until))).json(), COUNTRIES)])
  }
  let read = false
  for (const [source, fetchRows] of reads) {
    try {
      const rows = await fetchRows()
      await store(rows)
      const { error: e } = await supabaseAdmin.from('sensor_fetches').upsert({ source, fetched_at: new Date(now).toISOString() })
      if (e) throw new Error(e.message)
      bump(stats, STAT[source], rows.length)
      read = true
    } catch (err) {
      stats.sensors_error = `${source}: ${String(err).slice(0, 160)}`
      console.error(`[pipeline] sensor read ${source} failed (non-fatal):`, err)
    }
  }
  if (due('firms')) {
    const { error: e } = await supabaseAdmin.from('sensor_events').delete().lt('at', new Date(now - KEEP_DAYS * DAY).toISOString())
    if (e) stats.sensors_error = `prune: ${e.message}`
  }
  return read
}

// ── 2. Locate ────────────────────────────────────────────────────────────────

const LETTER = /\p{L}/gu
const LATIN = /\p{Script=Latin}/gu
/** Mostly Latin letters: the reports place names can be found in. */
export function isLatinScript(s: string): boolean {
  const letters = s.match(LETTER)?.length ?? 0
  return letters > 0 && (s.match(LATIN)?.length ?? 0) / letters >= 0.8
}

export const NONE = 'None of these places'

/** One Jev request: where, and could it start a fire, cut the internet, shake the ground. */
export function locateQuestions(candidates: Place[]): Record<string, unknown> {
  const where: Record<string, string | null> = {}
  for (const p of candidates) where[placeLabel(p)] ??= null
  where[NONE] = 'The event happened somewhere else or in several places, or the reports do not say where'
  return {
    where: { type: 'choice', instructions: 'Where did the event that `story` reports take place?', criteria: where },
    fire: {
      type: 'noul',
      instructions: 'Does `story` report a strike, attack, explosion or blaze that could set a building, depot, fuel site or ship on fire?',
    },
    outage: {
      type: 'noul',
      instructions:
        'Does `story` report something that could cut power, internet or phone service across a city or region: strikes on power plants, the grid or telecoms, a blackout, or a government shutting the internet down?',
    },
    blast: {
      type: 'noul',
      instructions: 'Does `story` report a nuclear test, or an explosion large enough to shake the ground, such as an ammunition depot blowing up?',
    },
  }
}

interface Member {
  story_id: string
  title: string
  summary: string | null
  published_at: string | null
}

async function storiesToLocate(now: number, lookbackHours: number, cap: number): Promise<Map<string, Member[]>> {
  const since = new Date(now - lookbackHours * H).toISOString()
  const { data, error } = await supabaseAdmin
    .from('articles')
    .select('story_id, severity, opinion, retrospective')
    .gte('published_at', since)
    .gte('severity', MAJOR_SEVERITY)
    .not('story_id', 'is', null)
    // Newest first: PostgREST returns at most 1,000 rows, ~40 h of major reports.
    .order('published_at', { ascending: false })
    .limit(1000)
  if (error) throw new Error(error.message)
  const ids = [
    ...new Set(
      (data ?? [])
        .filter((a) => (eventSeverity(a) ?? 0) >= MAJOR_SEVERITY && (a.opinion ?? 0) < SIGNAL_YES)
        .map((a) => a.story_id as string),
    ),
  ]
  // A story with no place is tried again after a while: a report that names
  // one may have joined it since.
  const retryBefore = now - RETRY_UNLOCATED_HOURS * H
  const located = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data: done, error: e } = await supabaseAdmin.from('story_places').select('story_id, place_id, located_at').in('story_id', ids.slice(i, i + 100))
    if (e) throw new Error(e.message)
    for (const d of done ?? []) if (d.place_id != null || Date.parse(d.located_at) > retryBefore) located.add(d.story_id)
  }
  const todo = ids.filter((id) => !located.has(id)).slice(0, cap)
  const members = new Map<string, Member[]>()
  for (let i = 0; i < todo.length; i += 100) {
    const { data: rows, error: e } = await supabaseAdmin
      .from('articles')
      .select('story_id, title, summary, published_at')
      .in('story_id', todo.slice(i, i + 100))
    if (e) throw new Error(e.message)
    for (const r of (rows ?? []) as Member[]) {
      const list = members.get(r.story_id)
      if (list) list.push(r)
      else members.set(r.story_id, [r])
    }
  }
  return members
}

export async function locateStories(stats: RunStats, deadlineMs: number, { now = Date.now(), lookbackHours = LOOKBACK_HOURS, cap = LOCATE_CAP } = {}): Promise<void> {
  const stories = await storiesToLocate(now, lookbackHours, cap)
  const rows: Array<Record<string, unknown>> = []
  const asked = await mapPool([...stories.entries()], LOCATE_CONCURRENCY, async ([storyId, members]) => {
    const dated = members.map((m) => Date.parse(m.published_at ?? '')).filter(Number.isFinite)
    const first_report_at = new Date(dated.length ? Math.min(...dated) : now).toISOString()
    // Jev reads every language; Latin-script reports first only because they
    // are the ones most readers of the state share.
    const reports = [...members].sort((a, b) => Number(isLatinScript(b.title)) - Number(isLatinScript(a.title))).slice(0, 12)
    const candidates = placesIn(reports.map((r) => `${r.title}. ${r.summary ?? ''}`).join('\n'))
    if (!candidates.length) {
      rows.push({ story_id: storyId, located_at: new Date(now).toISOString(), first_report_at })
      bump(stats, 'stories_unlocated', 1)
      return
    }
    const state = { story: { reports: reports.slice(0, 4).map((r) => ({ title: r.title, summary: (r.summary ?? '').replace(/\s+/g, ' ').slice(0, 300) })) } }
    const { answers, inputTokens } = await callJev(state, locateQuestions(candidates), deadlineMs)
    bump(stats, 'evidence_tokens', inputTokens)
    const choice = answers.where?.choice
    const p = choice ? (answers.where?.probabilities?.[choice] ?? 0) : 0
    const place = choice && choice !== NONE && p >= PLACE_YES ? candidates.find((c) => placeLabel(c) === choice) : undefined
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    rows.push({
      story_id: storyId,
      located_at: new Date(now).toISOString(),
      first_report_at,
      place_id: place?.id ?? null,
      name: place?.name ?? null,
      country: place?.country ?? null,
      lat: place?.lat ?? null,
      lon: place?.lon ?? null,
      p_fire: num(answers.fire?.noul),
      p_outage: num(answers.outage?.noul),
      p_blast: num(answers.blast?.noul),
    })
    bump(stats, place ? 'stories_located' : 'stories_unlocated', 1)
  }, { deadlineMs })
  if (asked.failed.length) console.error(`[pipeline] locating ${asked.failed.length} stories failed (retried next run):`, String(asked.failed[0].error).slice(0, 200))
  if (rows.length) await upsertSkippingGone('story_places', rows, 'story_id', false)
}

// ── 3. Match ─────────────────────────────────────────────────────────────────

export interface Located {
  story_id: string
  name: string
  country: string
  lat: number
  lon: number
  first_report_at: string
  p_fire: number | null
  p_outage: number | null
  p_blast: number | null
}

export interface Fire {
  at: string
  lat: number
  lon: number
  cell: string
  value: number
}

const round1 = (x: number) => Math.round(x * 10) / 10

/** The best new, big fire near a place around its first report, or null. */
export function bestFire(place: Located, placePopulation: number, fires: Fire[], burnedBefore: ReadonlySet<string>): Record<string, unknown> | null {
  const first = Date.parse(place.first_report_at)
  const radius = placePopulation >= FIRE.bigCity ? FIRE.bigCityKm : FIRE.radiusKm
  const near = fires.filter((f) => {
    const t = Date.parse(f.at)
    return t >= first - FIRE.beforeH * H && t <= first + FIRE.afterH * H &&
      kmBetween(place.lat, place.lon, f.lat, f.lon) <= radius &&
      !cellAndNeighbours(f.cell).some((c) => burnedBefore.has(c))
  })
  let best: Record<string, unknown> | null = null
  for (const top of [...near].sort((a, b) => b.value - a.value)) {
    const around = near.filter((f) => kmBetween(top.lat, top.lon, f.lat, f.lon) <= FIRE.clusterKm)
    const big = top.value >= FIRE.bigFrp || (top.value >= FIRE.minFrp && around.filter((f) => f.value >= FIRE.minFrp).length >= FIRE.minCount)
    if (!big) continue
    const t = Date.parse(top.at)
    best = {
      at: top.at,
      distance_km: round1(kmBetween(place.lat, place.lon, top.lat, top.lon)),
      value: top.value,
      detail: {
        detections: around.length,
        hours_from_first: round1((t - first) / H),
        lat: top.lat,
        lon: top.lon,
        url: `https://firms.modaps.eosdis.nasa.gov/map/#d:${top.at.slice(0, 10)};@${top.lon.toFixed(3)},${top.lat.toFixed(3)},12.0z`,
      },
    }
    break
  }
  return best
}

async function firesNear(place: Located): Promise<{ fires: Fire[]; burnedBefore: Set<string> }> {
  const first = Date.parse(place.first_report_at)
  const lo = new Date(first - FIRE.beforeH * H)
  const dLat = (FIRE.bigCityKm + 5) / 111
  const dLon = dLat / Math.max(0.2, Math.cos((place.lat * Math.PI) / 180))
  const { data, error } = await supabaseAdmin
    .from('sensor_events')
    .select('at, lat, lon, cell, value')
    .eq('kind', 'fire')
    .gte('at', lo.toISOString())
    .lte('at', new Date(first + FIRE.afterH * H).toISOString())
    .gte('lat', place.lat - dLat).lte('lat', place.lat + dLat)
    .gte('lon', place.lon - dLon).lte('lon', place.lon + dLon)
    .order('value', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  const fires = (data ?? []) as Fire[]
  const burnedBefore = new Set<string>()
  const cells = [...new Set(fires.slice(0, 30).flatMap((f) => cellAndNeighbours(f.cell)))]
  for (let i = 0; i < cells.length; i += 90) {
    const { data: old, error: e } = await supabaseAdmin
      .from('sensor_events')
      .select('cell')
      .eq('kind', 'fire')
      .in('cell', cells.slice(i, i + 90))
      .gte('at', new Date(lo.getTime() - FIRE.quietDays * DAY).toISOString())
      .lt('at', lo.toISOString())
    if (e) throw new Error(e.message)
    for (const o of old ?? []) if (o.cell) burnedBefore.add(o.cell)
  }
  return { fires, burnedBefore }
}

async function quakeNear(place: Located): Promise<Record<string, unknown> | null> {
  const first = Date.parse(place.first_report_at)
  const d = (QUAKE.radiusKm + 5) / 111
  const { data, error } = await supabaseAdmin
    .from('sensor_events')
    .select('at, lat, lon, value, detail')
    .eq('kind', 'quake')
    .gte('at', new Date(first - QUAKE.beforeH * H).toISOString())
    .lte('at', new Date(first + QUAKE.afterH * H).toISOString())
    .gte('lat', place.lat - d).lte('lat', place.lat + d)
    .gte('lon', place.lon - d * 2).lte('lon', place.lon + d * 2)
  if (error) throw new Error(error.message)
  const near = (data ?? [])
    .filter((q) => q.lat != null && q.lon != null && kmBetween(place.lat, place.lon, q.lat, q.lon) <= QUAKE.radiusKm)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const q = near[0]
  if (!q) return null
  const detail = (q.detail ?? {}) as { type?: string; url?: string }
  return {
    at: q.at,
    distance_km: round1(kmBetween(place.lat, place.lon, q.lat!, q.lon!)),
    value: q.value,
    detail: { type: detail.type ?? 'earthquake', url: detail.url, hours_from_first: round1((Date.parse(q.at) - first) / H) },
  }
}

async function outageIn(place: Located): Promise<Record<string, unknown> | null> {
  const first = Date.parse(place.first_report_at)
  const { data, error } = await supabaseAdmin
    .from('sensor_events')
    .select('at, value, detail')
    .eq('kind', 'outage')
    .eq('detail->>country', place.country)
    .gte('at', new Date(first - OUTAGE.beforeH * H).toISOString())
    .lte('at', new Date(first + OUTAGE.afterH * H).toISOString())
    .order('value', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const o = data?.[0]
  if (!o) return null
  const detail = (o.detail ?? {}) as { duration_s?: number }
  const t = Date.parse(o.at)
  const from = Math.floor(t / 1000) - 6 * 3600
  return {
    at: o.at,
    distance_km: null,
    value: o.value,
    detail: {
      duration_s: detail.duration_s ?? null,
      hours_from_first: round1((t - first) / H),
      url: `https://ioda.inetintel.cc.gatech.edu/country/${place.country}?from=${from}&until=${from + 18 * 3600}`,
    },
  }
}

export async function matchEvidence(stats: RunStats, { now = Date.now(), sinceHours = FIRE.afterH + 6 } = {}): Promise<void> {
  // Readings keep arriving for FIRE.afterH after the first report, plus the
  // satellites' few hours of delay.
  const since = new Date(now - sinceHours * H).toISOString()
  const { data, error } = await supabaseAdmin
    .from('story_places')
    .select('story_id, place_id, name, country, lat, lon, first_report_at, p_fire, p_outage, p_blast')
    .not('place_id', 'is', null)
    .gte('first_report_at', since)
    .limit(1000)
  if (error) throw new Error(error.message)
  const places = (data ?? []) as Array<Located & { place_id: number }>
  if (!places.length) return
  const found: Array<Record<string, unknown>> = []
  for (const place of places) {
    const add = (kind: string, e: Record<string, unknown> | null, where: string) => {
      if (e) found.push({ story_id: place.story_id, kind, place: where, found_at: new Date(now).toISOString(), ...e })
    }
    if ((place.p_fire ?? 0) >= CAUSE_YES) {
      const { fires, burnedBefore } = await firesNear(place)
      add('fire', bestFire(place, placeById(place.place_id)?.population ?? 0, fires, burnedBefore), place.name)
    }
    if ((place.p_blast ?? 0) >= CAUSE_YES) add('quake', await quakeNear(place), place.name)
    if ((place.p_outage ?? 0) >= CAUSE_YES) add('outage', await outageIn(place), COUNTRY_NAMES[place.country] ?? place.country)
  }
  if (!found.length) return
  await upsertSkippingGone('story_evidence', found, 'story_id,kind', false)
  bump(stats, 'evidence_found', found.length)
}

// A story a merge deleted after we read it fails its foreign key. Write the
// batch; if that fails, write row by row and skip only those.
async function upsertSkippingGone(table: 'story_places' | 'story_evidence', rows: Array<Record<string, unknown>>, onConflict: string, ignoreDuplicates: boolean): Promise<void> {
  const { error } = await supabaseAdmin.from(table).upsert(rows as never, { onConflict, ignoreDuplicates })
  if (!error) return
  if (error.code !== '23503') throw new Error(error.message)
  for (const row of rows) {
    const { error: e } = await supabaseAdmin.from(table).upsert(row as never, { onConflict, ignoreDuplicates })
    if (e && e.code !== '23503') throw new Error(e.message)
  }
}

export async function gatherEvidence(stats: RunStats, deadlineMs: number): Promise<void> {
  try {
    const read = await readSensors(stats)
    await locateStories(stats, deadlineMs)
    // Nothing new to set against the stories unless a sensor was read.
    if (read) await matchEvidence(stats)
  } catch (err) {
    stats.evidence_error = String(err).slice(0, 200)
    console.error('[pipeline] sensor evidence failed (non-fatal):', err)
  }
}
