import type { SourceAudit } from '../../src/lib/source-audit'

export const curatedFields = ['url', 'name', 'region', 'lang', 'enabled', 'affiliation'] as const
export type Curated = { url: string; name: string; region: string; lang: string; enabled: boolean; affiliation: string | null }
export type Probe = { sourceId: string | null; url: string; checkedAt: string; error: unknown; itemCount: number }
export type RosterChange = { sourceId: string; before: Curated; after: Curated; reason: string; evidence: string[] }
export type RosterPlan = { version: 1; id: string; reviewedAt: string; changes: RosterChange[] }

export function curated(row: Curated): Curated {
  return Object.fromEntries(curatedFields.map(k => [k, row[k]])) as Curated
}
export function matches(row: Curated, expected: Curated): boolean {
  return curatedFields.every(k => row[k] === expected[k])
}

/** Fail closed: a reviewed decision and two independent production probes precede new fetching. */
export function validatePlan(plan: RosterPlan, audit: SourceAudit, probes: Probe[], now = Date.now(), requireReview = true): string[] {
  const errors: string[] = []
  const validUrl = (s: string) => { try { return ['https:', 'http:'].includes(new URL(s).protocol) } catch { return false } }
  if (plan.version !== 1 || !/^[a-z0-9-]+$/.test(plan.id) || !Number.isFinite(Date.parse(plan.reviewedAt))) errors.push('Invalid plan header')
  if (!plan.changes.length || new Set(plan.changes.map(c => c.sourceId)).size !== plan.changes.length) errors.push('Empty or duplicate changes')
  for (const c of plan.changes) {
    if (!c.reason || !c.evidence?.length || c.evidence.some(u => !validUrl(u))) errors.push(`Missing evidence: ${c.sourceId}`)
    for (const row of [c.before, c.after]) {
      if (Object.keys(row).sort().join() !== [...curatedFields].sort().join()
        || !validUrl(row.url) || !row.name || !row.region || !row.lang || typeof row.enabled !== 'boolean'
        || !(row.affiliation === null || ['state','public','exile'].includes(row.affiliation))) errors.push(`Invalid curated fields: ${c.sourceId}`)
    }
    if (!requireReview) continue // Rollback still validates fields and evidence, but restores the prior curation decision.
    const review = audit.sources.find(s => s.sourceId === c.sourceId)
    if (!review || review.decision === 'unresolved') errors.push(`Review unresolved: ${c.sourceId}`)
    if (review?.decision === 'exclude' && c.after.enabled) errors.push(`Excluded source cannot be enabled: ${c.sourceId}`)
    if (c.after.enabled && (!c.before.enabled || c.before.url !== c.after.url)) {
      const times = probes.filter(p => p.sourceId === c.sourceId && p.url === c.after.url && !p.error && p.itemCount > 0)
        .map(p => Date.parse(p.checkedAt)).filter(t => Number.isFinite(t) && t <= now && now - t <= 7 * 86400000)
      if (times.length < 2 || Math.max(...times) - Math.min(...times) < 15 * 60000) errors.push(`Two successful probes 15 minutes apart required: ${c.sourceId}`)
    }
  }
  return errors
}

/** Rollback restores curation only, never stale health counters or historical articles. */
export function reversePlan(plan: RosterPlan): RosterPlan {
  return { ...plan, id: `${plan.id}-rollback`, changes: [...plan.changes].reverse().map(c => ({ ...c, before: c.after, after: c.before })) }
}
