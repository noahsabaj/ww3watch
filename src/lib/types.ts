// src/lib/types.ts

// ── Single source of truth for regions ──────────────────────────────────────
// To add a new region: add one entry here. Everything else is derived.
export const REGIONS = {
  'US/Western':          { color: 'bg-blue-600 text-white',    border: 'border-blue-600'    },
  'UK':                  { color: 'bg-blue-400 text-white',    border: 'border-blue-400'    },
  'European':            { color: 'bg-indigo-500 text-white',  border: 'border-indigo-500'  },
  'Israeli':             { color: 'bg-orange-500 text-white',  border: 'border-orange-500'  },
  'Iranian State':       { color: 'bg-red-700 text-white',     border: 'border-red-700'     },
  'Iranian Independent': { color: 'bg-amber-500 text-black',   border: 'border-amber-500'   },
  'Iranian Local':       { color: 'bg-yellow-400 text-black',  border: 'border-yellow-400'  },
  'Arab/Gulf':           { color: 'bg-teal-600 text-white',    border: 'border-teal-600'    },
  'Kurdish':             { color: 'bg-purple-600 text-white',  border: 'border-purple-600'  },
  'Turkish':             { color: 'bg-slate-500 text-white',   border: 'border-slate-500'   },
  'Russian':             { color: 'bg-rose-700 text-white',    border: 'border-rose-700'    },
  'Chinese':             { color: 'bg-red-500 text-white',     border: 'border-red-500'     },
  'South Asian':         { color: 'bg-emerald-600 text-white', border: 'border-emerald-600' },
  'East Asian':          { color: 'bg-cyan-600 text-white',    border: 'border-cyan-600'    },
  'African':             { color: 'bg-lime-600 text-white',    border: 'border-lime-600'    },
  'Independent/OSINT':   { color: 'bg-gray-600 text-white',    border: 'border-gray-600'    },
} as const

export type SourceRegion = keyof typeof REGIONS

export interface Article {
  id: string
  guid: string
  title: string
  url: string
  summary: string | null
  published_at: string | null
  fetched_at: string
  source_name: string
  source_region: SourceRegion
  source_lang: string
  feed_url: string
  cluster_id: string | null
}

export interface Feed {
  name: string
  url: string
  region: SourceRegion
  lang: string
}

export const ALL_REGIONS = Object.keys(REGIONS) as SourceRegion[]
export const REGION_COLORS = Object.fromEntries(
  Object.entries(REGIONS).map(([k, v]) => [k, v.color])
) as Record<SourceRegion, string>
export const REGION_BORDER = Object.fromEntries(
  Object.entries(REGIONS).map(([k, v]) => [k, v.border])
) as Record<SourceRegion, string>
