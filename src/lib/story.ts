// Story-level readings of the per-article signals (src/lib/signals.ts). Pure
// functions over data the client already holds — shared by the feed, the cards
// and the pipeline's trending ranker, so "how corroborated" and "how important"
// mean one thing everywhere. Nothing here may import server-only code.
import type { Article } from './types'
import { wireDuplicateIds, type Cluster } from './cluster'
import { isClaim, isMajor, isOpinion, isUnverified, MAJOR_SEVERITY, type ArticleSignals } from './signals'

// Counting is code's job, not a model's. Log-scaled: the step from 1 source to 3
// is worth more than from 9 to 11. Breadth across regions and languages is the
// strongest sign a story is real and not one bloc's echo.
export function corroboration(c: { independent: number; regions: number; langs: number }): number {
  const sources = Math.min(1, Math.log2(1 + c.independent) / Math.log2(1 + 8))
  const regions = Math.min(1, (c.regions - 1) / 3)
  const langs = Math.min(1, (c.langs - 1) / 2)
  return 0.6 * sources + 0.25 * regions + 0.15 * langs
}

export type MemberKind = 'event' | 'statement' | 'analysis'

/** What kind of report an article is; null until Jev has annotated it. */
export function memberKind(a: Pick<Article, 'claim' | 'opinion'>): MemberKind | null {
  if (a.claim == null && a.opinion == null) return null
  if (isOpinion({ opinion: a.opinion ?? null })) return 'analysis'
  if (isClaim({ claim: a.claim ?? null })) return 'statement'
  return 'event'
}

export interface StorySignals {
  /** Highest severity among independent (non-wire) members; null if none annotated. */
  topSeverity: number | null
  /** At least one independent member reports a significant event. */
  major: boolean
  /** EVERY annotated independent member hedges its central fact. One outlet
   *  stating it flatly is enough to drop the tag. */
  unconfirmed: boolean
  /** Every annotated independent member is a statement or analysis: nobody in
   *  the story reports something that happened. */
  talkOnly: boolean
  independent: number
  regions: number
  langs: number
}

export function storySignals(articles: Article[]): StorySignals {
  const wire = wireDuplicateIds(articles)
  const own = articles.filter((a) => !wire.has(a.id))
  const annotated = own.filter((a) => a.severity != null || a.claim != null)
  const severities = annotated.map((a) => a.severity).filter((s): s is number => s != null)
  return {
    topSeverity: severities.length ? Math.max(...severities) : null,
    major: annotated.some((a) => isMajor({ severity: a.severity ?? null })),
    unconfirmed: annotated.length > 0 && annotated.every((a) => isUnverified({ unverified: a.unverified ?? null })),
    talkOnly: annotated.length > 0 && annotated.every((a) => memberKind(a) !== 'event'),
    independent: new Set(own.map((a) => a.source_name)).size,
    regions: new Set(articles.map((a) => a.source_region)).size,
    langs: new Set(articles.map((a) => a.source_lang)).size,
  }
}

// The badges a story wears. They describe the STORY, not whichever member
// happens to represent it: major if any independent source reports a
// significant event, unconfirmed only if every one of them hedges,
// statement/analysis only if nobody reports something that happened. A single
// article is its own story.
export function storyBadgeSignals(cluster: Cluster): Partial<ArticleSignals> {
  const rep = cluster.representative
  if (cluster.sourceCount === 1) return rep
  const story = storySignals(cluster.articles)
  return {
    severity: story.topSeverity,
    unverified: story.unconfirmed ? 1 : 0,
    claim: story.talkOnly ? (rep.claim ?? 1) : 0,
    opinion: story.talkOnly ? (rep.opinion ?? 0) : 0,
  }
}

export interface SideGroup {
  /** Region label, plus the affiliation when every member of the group shares one. */
  region: string
  affiliation: string | null
  articles: Article[]
}

// "Who says what": the same story as each bloc tells it. Grouped by source
// region; state-affiliated outlets are split out from independent ones in the
// same region, because that split is the point.
export function bySide(articles: Article[]): SideGroup[] {
  const groups = new Map<string, SideGroup>()
  for (const a of articles) {
    const affiliation = a.source_affiliation === 'state' ? 'state' : null
    const key = `${a.source_region}|${affiliation ?? ''}`
    const g = groups.get(key)
    if (g) g.articles.push(a)
    else groups.set(key, { region: a.source_region, affiliation, articles: [a] })
  }
  const t = (a: Article) => (a.published_at ? Date.parse(a.published_at) : Infinity)
  for (const g of groups.values()) g.articles.sort((x, y) => t(x) - t(y))
  return [...groups.values()].sort((x, y) => y.articles.length - x.articles.length || x.region.localeCompare(y.region))
}

export { MAJOR_SEVERITY }
