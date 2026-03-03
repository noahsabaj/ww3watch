// src/lib/types.ts

export type SourceRegion =
  | 'US/Western'
  | 'UK'
  | 'European'
  | 'Israeli'
  | 'Iranian State'
  | 'Iranian Independent'
  | 'Iranian Local'
  | 'Arab/Gulf'
  | 'Kurdish'
  | 'Turkish'
  | 'Russian'
  | 'Chinese'
  | 'South Asian'
  | 'Independent/OSINT'

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
}

export interface Feed {
  name: string
  url: string
  region: SourceRegion
  lang: string
}

export const REGION_COLORS: Record<SourceRegion, string> = {
  'US/Western':          'bg-blue-600 text-white',
  'UK':                  'bg-blue-400 text-white',
  'European':            'bg-indigo-500 text-white',
  'Israeli':             'bg-orange-500 text-white',
  'Iranian State':       'bg-red-700 text-white',
  'Iranian Independent': 'bg-amber-500 text-black',
  'Iranian Local':       'bg-yellow-400 text-black',
  'Arab/Gulf':           'bg-teal-600 text-white',
  'Kurdish':             'bg-purple-600 text-white',
  'Turkish':             'bg-slate-500 text-white',
  'Russian':             'bg-rose-700 text-white',
  'Chinese':             'bg-red-500 text-white',
  'South Asian':         'bg-emerald-600 text-white',
  'Independent/OSINT':   'bg-gray-600 text-white',
}

export const REGION_BORDER: Record<SourceRegion, string> = {
  'US/Western':          'border-blue-600',
  'UK':                  'border-blue-400',
  'European':            'border-indigo-500',
  'Israeli':             'border-orange-500',
  'Iranian State':       'border-red-700',
  'Iranian Independent': 'border-amber-500',
  'Iranian Local':       'border-yellow-400',
  'Arab/Gulf':           'border-teal-600',
  'Kurdish':             'border-purple-600',
  'Turkish':             'border-slate-500',
  'Russian':             'border-rose-700',
  'Chinese':             'border-red-500',
  'South Asian':         'border-emerald-600',
  'Independent/OSINT':   'border-gray-600',
}
