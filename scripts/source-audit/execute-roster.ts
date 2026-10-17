import { curated, matches, type Curated, type RosterPlan } from './roster-plan'

export type Snapshot = Curated & { updated_at: string }
export type JournalEntry = {
  sourceId: string
  before: Curated
  after: Curated
  state: 'prepared' | 'applied' | 'already-matches'
}
export type HealthReset = {
  consecutive_failures: 0
  last_ok_at: null
  last_error: null
  last_error_kind: null
  last_via: null
}
/** A new URL also drops what the old one answered: its ETag/Last-Modified would
 *  be sent to the new endpoint, which may answer 304 and never deliver an item
 *  (Brookings, 2026-10-17), and its newest item says nothing about the new feed. */
export type EndpointReset = HealthReset & {
  feed_etag: null
  feed_last_modified: null
  newest_item_at: null
}
export interface RosterStore {
  read(id: string): Promise<Snapshot>
  compareAndSet(id: string, observedUpdatedAt: string, after: Curated, reset: EndpointReset | HealthReset | Record<string, never>): Promise<boolean>
}

/** Preflight all rows and journal each before-value before attempting its write. */
export async function executeRoster(plan: RosterPlan, dryRun: boolean, store: RosterStore, save: (entries: JournalEntry[]) => void) {
  const entries: JournalEntry[] = []
  save(entries)
  const snapshots = await Promise.all(plan.changes.map(async c => {
    const row = await store.read(c.sourceId)
    if (!matches(row, c.before) && !matches(row, c.after)) throw new Error(`Curation changed; rebase the plan: ${c.sourceId}`)
    return row
  }))
  for (const [i, c] of plan.changes.entries()) {
    const snapshot = snapshots[i]
    const entry: JournalEntry = { sourceId: c.sourceId, before: curated(snapshot), after: c.after, state: 'prepared' }
    entries.push(entry)
    if (matches(snapshot, c.after)) {
      entry.state = 'already-matches'
      save(entries)
      continue
    }
    save(entries)
    if (dryRun) continue
    const health: HealthReset = { consecutive_failures: 0, last_ok_at: null, last_error: null, last_error_kind: null, last_via: null }
    const reset: EndpointReset | HealthReset | Record<string, never> = c.before.url !== c.after.url
      ? { ...health, feed_etag: null, feed_last_modified: null, newest_item_at: null }
      : !c.before.enabled && c.after.enabled ? health : {}
    const applied = await store.compareAndSet(c.sourceId, snapshot.updated_at, c.after, reset)
    if (!applied) throw new Error(`Curation write failed or snapshot changed: ${c.sourceId}; inspect the journal before retrying`)
    entry.state = 'applied'
    save(entries)
  }
  return entries
}
