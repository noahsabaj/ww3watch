// The sides of a conflict whose newsrooms the site carries, and the rivalries
// between them (#2): when a story is covered from both sides of one, its
// reader sees each side's headline. Nothing here may import server-only code.
import type { Article } from './types'
import type { Actor } from './signals'

export type Bloc = 'russia' | 'ukraine' | 'iran' | 'israel' | 'china' | 'west'

const BLOC_COUNTRY: Record<Bloc, string> = {
  russia: 'Russian', ukraine: 'Ukrainian', iran: 'Iranian', israel: 'Israeli', china: 'Chinese', west: 'Western',
}

/** A newsroom's side, or none. An exile outlet (Meduza, Iran International)
 *  reports against its government, and a foreign-funded service in the
 *  language (Radio Svoboda, Radio Farda) is not the government's either; in
 *  Russia and China only state outlets speak for the state (the South China
 *  Morning Post does not). */
export function blocOf(a: Pick<Article, 'source_region' | 'source_affiliation'>): Bloc | null {
  const aff = a.source_affiliation
  if (aff === 'exile') return null
  switch (a.source_region) {
    case 'Russian': return aff === 'state' ? 'russia' : null
    case 'Chinese': return aff === 'state' ? 'china' : null
    case 'Iranian': return aff === 'public' ? null : 'iran'
    case 'Ukrainian': return aff === 'public' ? null : 'ukraine'
    case 'Israeli': return aff === 'public' ? null : 'israel'
    case 'US/Western': case 'UK': case 'European': return 'west'
    default: return null
  }
}

/** "Russian state media", "Ukrainian media": what the reader is told a headline stands for. */
export const sideLabel = (a: Pick<Article, 'source_region' | 'source_affiliation'>): string | null => {
  const bloc = blocOf(a)
  return bloc ? `${BLOC_COUNTRY[bloc]} ${a.source_affiliation === 'state' ? 'state media' : 'media'}` : null
}

// Rivalries, the war's own first. A story belongs to one only when Jev's
// actor tags name a party on each side: a Russian and a Western outlet on
// Pakistan striking Afghanistan are not the two sides of anything.
const RIVALRIES: Array<{ sides: [Bloc, Bloc]; parties: [Actor[], Actor[]] }> = [
  { sides: ['russia', 'ukraine'], parties: [['russia'], ['ukraine']] },
  { sides: ['iran', 'israel'], parties: [['iran', 'lebanon', 'palestine', 'yemen'], ['israel']] },
  // The West backs Ukraine and Israel: a Russian state outlet and a Western
  // one on the war in Ukraine are that war's two sides too.
  { sides: ['russia', 'west'], parties: [['russia'], ['us', 'europe_nato', 'ukraine']] },
  { sides: ['iran', 'west'], parties: [['iran', 'lebanon', 'yemen'], ['us', 'europe_nato', 'israel']] },
  { sides: ['china', 'west'], parties: [['china'], ['us', 'taiwan']] },
]

export interface Sides {
  sides: [Bloc, Bloc]
  /** Each side's first report on the story: what it said when it broke. */
  first: [Article, Article]
}

/** The two sides a story is covered from, and each one's first report; null when it is not. */
export function storySides(articles: Article[]): Sides | null {
  const byBloc = new Map<Bloc, Article[]>()
  for (const a of articles) {
    const b = blocOf(a)
    if (b) byBloc.set(b, [...(byBloc.get(b) ?? []), a])
  }
  const actors = new Set(articles.flatMap((a) => a.actors ?? []))
  const rivalry = RIVALRIES.find(
    (r) => byBloc.has(r.sides[0]) && byBloc.has(r.sides[1]) && r.parties.every((party) => party.some((x) => actors.has(x))),
  )
  if (!rivalry) return null
  const earliest = (list: Article[]) =>
    list.reduce((best, a) => ((Date.parse(a.published_at ?? '') || Infinity) < (Date.parse(best.published_at ?? '') || Infinity) ? a : best))
  return { sides: rivalry.sides, first: [earliest(byBloc.get(rivalry.sides[0])!), earliest(byBloc.get(rivalry.sides[1])!)] }
}
