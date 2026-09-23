// src/lib/types.ts

// ── Single source of truth for regions ──────────────────────────────────────
// To add a new region: add one entry here. Everything else is derived.
// color/border: the dot and bar classes; wash: the RGB a story's surface is
// tinted with when its lead outlet is from here (region-wash.ts).
export const REGIONS = {
  'US/Western':          { color: 'bg-blue-600 text-white',    border: 'border-blue-600', wash: '59, 99, 180' },
  'UK':                  { color: 'bg-blue-400 text-white',    border: 'border-blue-400', wash: '80, 130, 190' },
  'European':            { color: 'bg-indigo-500 text-white',  border: 'border-indigo-500', wash: '90, 96, 170' },
  'Israeli':             { color: 'bg-orange-500 text-white',  border: 'border-orange-500', wash: '196, 112, 62' },
  // Geography only — the state/independent split lives in sources.affiliation now
  // (collapsed from the former Iranian State/Independent/Local buckets in PR-B).
  'Iranian':             { color: 'bg-red-700 text-white',     border: 'border-red-700', wash: '150, 58, 58' },
  'Arab/Gulf':           { color: 'bg-teal-600 text-white',    border: 'border-teal-600', wash: '46, 128, 128' },
  'Kurdish':             { color: 'bg-purple-600 text-white',  border: 'border-purple-600', wash: '120, 80, 160' },
  'Turkish':             { color: 'bg-slate-500 text-white',   border: 'border-slate-500', wash: '160, 96, 80' },
  'Russian':             { color: 'bg-rose-700 text-white',    border: 'border-rose-700', wash: '160, 70, 80' },
  'Ukrainian':           { color: 'bg-yellow-500 text-black',  border: 'border-yellow-500', wash: '180, 150, 50' },
  'Chinese':             { color: 'bg-red-500 text-white',     border: 'border-red-500', wash: '170, 60, 60' },
  'South Asian':         { color: 'bg-emerald-600 text-white', border: 'border-emerald-600', wash: '70, 140, 110' },
  'East Asian':          { color: 'bg-cyan-600 text-white',    border: 'border-cyan-600', wash: '50, 140, 150' },
  'African':             { color: 'bg-lime-600 text-white',    border: 'border-lime-600', wash: '90, 140, 80' },
  'Independent/OSINT':   { color: 'bg-gray-600 text-white',    border: 'border-gray-600', wash: '120, 118, 110' },
} as const

export type SourceRegion = keyof typeof REGIONS

import type { Actor, Topic } from './signals'

export interface Article {
  id: string
  title: string
  url: string
  summary: string | null
  published_at: string | null
  fetched_at: string
  source_name: string
  source_region: SourceRegion
  source_lang: string
  // Curated outlet allegiance (state | public | exile | null), denormalized
  // from sources.affiliation at ingest.
  source_affiliation: string | null
  body_hash: string | null
  story_id: string | null
  // Jev's per-article signals (src/lib/signals.ts). Absent until the pipeline's
  // signals stage has annotated the row — seconds after insert, normally.
  topic?: Topic | null
  severity?: number | null
  claim?: number | null
  unverified?: number | null
  opinion?: number | null
  actors?: Actor[] | null
  // Publisher photograph (RSS media or og:image). Optional: SW-cached pre-image
  // REST rows omit it, and the pipeline leaves it null when the newsroom published none.
  image_url?: string | null
  // The pipeline's photo check (photo-check.ts): only 'photo' is ever shown;
  // null (not looked at yet), 'emblem' and 'reused' are not.
  image_verdict?: string | null
  image_width?: number | null
  image_height?: number | null
  // Dropped from the feed's boot query (unused client-side) but still delivered
  // on realtime row payloads — hence optional. The pipeline/server use the
  // separate ArticleInsert shape.
  guid?: string
  feed_url?: string
  source_id?: string | null
}

// The fetchable shape of a roster entry. The roster itself lives in the
// `sources` table (seeded by 20260611_sources.sql; health written back by the
// pipeline every run) — `id` is present on DB rows and stamps articles'
// provenance FK; test fixtures may omit it.
export interface Feed {
  id?: string
  name: string
  url: string
  region: SourceRegion
  lang: string
  affiliation?: string | null
}

export const ALL_REGIONS = Object.keys(REGIONS) as SourceRegion[]
export const REGION_COLORS = Object.fromEntries(
  Object.entries(REGIONS).map(([k, v]) => [k, v.color])
) as Record<SourceRegion, string>
export const REGION_BORDER = Object.fromEntries(
  Object.entries(REGIONS).map(([k, v]) => [k, v.border])
) as Record<SourceRegion, string>
