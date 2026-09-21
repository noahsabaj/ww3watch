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
export interface RosterStore {
  read(id: string): Promise<Snapshot>
  compareAndSet(id: string, observedUpdatedAt: string, after: Curated, reset: HealthReset | Record<string, never>): Promise<boolean>
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
    const reset: HealthReset | Record<string, never> = c.before.url !== c.after.url || (!c.before.enabled && c.after.enabled)
      ? { consecutive_failures: 0, last_ok_at: null, last_error: null, last_error_kind: null, last_via: null } : {}
    const applied = await store.compareAndSet(c.sourceId, snapshot.updated_at, c.after, reset)
    if (!applied) throw new Error(`Curation write failed or snapshot changed: ${c.sourceId}; inspect the journal before retrying`)
    entry.state = 'applied'
    save(entries)
  }
  return entries
}
