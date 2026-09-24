// Theaters: where a story is happening, as a reader would name the place
// ("Ukraine", "Korean Peninsula"), not which country's newsroom filed it. Built
// entirely from the actors Jev already tags on every article (src/lib/signals.ts),
// so there is nothing new to classify or store.
import type { Cluster } from './cluster'
import type { Actor } from './signals'
import { isMajor } from './signals'

export interface Theater {
  id: string
  label: string
  /** The actors that place a story here, with how strongly (see WEIGHT). */
  actors: readonly Actor[]
  /** A thin bar or dot, never a fill (ui: region colour only as a dot or bar). */
  color: string
}

// Order breaks ties, so the narrower theater comes first: a Houthi strike on
// Riyadh (yemen + gulf) is the Red Sea's story before it is the Gulf's.
export const THEATERS: readonly Theater[] = [
  { id: 'ukraine', label: 'Ukraine', actors: ['ukraine', 'russia'], color: '#c9a53a' },
  { id: 'red-sea', label: 'Red Sea & Yemen', actors: ['yemen'], color: '#3c9a8f' },
  { id: 'lebanon-syria', label: 'Lebanon & Syria', actors: ['lebanon', 'syria'], color: '#8a62b8' },
  { id: 'israel-gaza', label: 'Israel & Gaza', actors: ['palestine', 'israel'], color: '#d07a45' },
  { id: 'iran-gulf', label: 'Iran & the Gulf', actors: ['iran', 'iraq', 'gulf'], color: '#b35050' },
  { id: 'koreas', label: 'Korean Peninsula', actors: ['koreas'], color: '#3a9aa8' },
  { id: 'china-taiwan', label: 'China & Taiwan', actors: ['taiwan', 'china'], color: '#c05555' },
  { id: 'south-asia', label: 'South Asia', actors: ['india_pakistan', 'afghanistan'], color: '#4f9a78' },
  { id: 'europe-nato', label: 'Europe & NATO', actors: ['europe_nato', 'turkey'], color: '#6a70c0' },
  { id: 'africa', label: 'Africa', actors: ['africa'], color: '#6f9a55' },
  { id: 'americas', label: 'Latin America', actors: ['latin_america'], color: '#b0806a' },
]

// The powers that turn up in other theaters' stories count for less, so they
// never outvote the place itself: Israel striking Lebanon is Lebanon's story,
// a Russian drone over Lithuania is NATO's, Iran and Israel trading fire is
// Iran's. The United States is in too many stories to place any of them.
const WEIGHT: Partial<Record<Actor, number>> = { israel: 0.5, russia: 0.5, china: 0.5 }

const byActor = new Map<Actor, Theater>(THEATERS.flatMap((t) => t.actors.map((a) => [a, t] as const)))
const cache = new WeakMap<Cluster, Theater | null>()

/** The theater a story belongs to, or null when its actors name no place. */
export function theaterOf(cluster: Cluster): Theater | null {
  const hit = cache.get(cluster)
  if (hit !== undefined) return hit
  const score = new Map<Theater, number>()
  for (const a of cluster.articles) {
    for (const actor of a.actors ?? []) {
      const t = byActor.get(actor)
      if (t) score.set(t, (score.get(t) ?? 0) + (WEIGHT[actor] ?? 1))
    }
  }
  let best: Theater | null = null
  let top = 0
  for (const t of THEATERS) {
    const s = score.get(t) ?? 0
    if (s > top) { top = s; best = t }
  }
  cache.set(cluster, best)
  return best
}

export function theaterById(id: string | null): Theater | null {
  return THEATERS.find((t) => t.id === id) ?? null
}

export interface TheaterSummary {
  theater: Theater
  /** Every loaded story placed here, newest first. */
  stories: Cluster[]
  /** Stories in the last 24 hours. */
  today: number
  /** Of those, how many are major (a significant event or worse). */
  major: number
  /** The one to lead with: the most widely covered of the last day. */
  lead: Cluster
}

const DAY_MS = 24 * 60 * 60 * 1000
const at = (c: Cluster) => c.updatedAt

// Widest coverage leads; among equals, one an English-language outlet also
// reported, so the row can be read without translating it.
const leadScore = (c: Cluster) => c.sourceCount + (c.articles.some((a) => a.source_lang === 'en') ? 0.5 : 0)

/** Every theater with at least one story, busiest first. */
export function theaterBoard(clusters: Cluster[], now: number): TheaterSummary[] {
  const groups = new Map<Theater, Cluster[]>()
  for (const c of clusters) {
    const t = theaterOf(c)
    if (!t) continue
    const g = groups.get(t)
    if (g) g.push(c)
    else groups.set(t, [c])
  }
  return [...groups.entries()]
    .map(([theater, stories]) => {
      const recent = stories.filter((c) => now - at(c) < DAY_MS)
      const pool = recent.length > 0 ? recent : stories
      const lead = pool.reduce((best, c) => (leadScore(c) > leadScore(best) ? c : best), pool[0])
      return {
        theater,
        stories,
        today: recent.length,
        major: recent.filter((c) => c.articles.some((a) => isMajor({ severity: a.severity ?? null, retrospective: a.retrospective }))).length,
        lead,
      }
    })
    .sort((a, b) => b.today - a.today || b.stories.length - a.stories.length)
}
