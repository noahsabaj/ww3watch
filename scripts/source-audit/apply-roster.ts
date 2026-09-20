// Run through source-curation.yml, serialized with ingestion. Default is dry-run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types'
import { sourceAudit } from '../../src/lib/data/source-audit'
import { curated, matches, reversePlan, validatePlan, type RosterPlan, type Probe } from './roster-plan'

const path = process.env.ROSTER_PLAN ?? ''
if (!/^data\/source-audit\/rosters\/[a-z0-9-]+\.json$/.test(path)) throw new Error('ROSTER_PLAN must name a committed roster plan')
const mode = process.env.ROSTER_MODE ?? 'dry-run'
if (!['dry-run','apply','rollback'].includes(mode)) throw new Error('Invalid ROSTER_MODE')
if (mode !== 'dry-run' && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.CURATION_SERIALIZED !== 'true')) throw new Error('Apply/rollback require the serialized main-branch curation workflow')
const original: RosterPlan = JSON.parse(readFileSync(path,'utf8'))
const probes: Probe[] = JSON.parse(readFileSync('data/source-audit/probes.json','utf8')).results
// Rollback can restore the pre-audit enabled state without pretending it passed a new review.
// It still checks expected curation values, and never recreates or deletes history.
const errors = validatePlan(original,sourceAudit,probes,Date.now(),mode !== 'rollback')
if (errors.length) throw new Error(errors.join('\n'))
const plan = mode === 'rollback' ? reversePlan(original) : original
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('Database credentials required')
const db = createClient<Database>(url,key,{ auth: { persistSession: false } })
const journal: { plan: string; mode: string; startedAt: string; changes: unknown[] } = { plan: plan.id, mode, startedAt: new Date().toISOString(), changes: [] }
mkdirSync('.tmp/source-audit',{ recursive: true })
function save() { writeFileSync('.tmp/source-audit/curation-journal.json',JSON.stringify(journal,null,2)+'\n') }
save()
// Preflight the entire batch before its first mutation.
const snapshots = await Promise.all(plan.changes.map(async c => {
  const { data, error } = await db.from('sources').select('*').eq('id',c.sourceId).single()
  if (error || !data) throw new Error(`Source unavailable: ${c.sourceId}`)
  if (!matches(data,c.before) && !matches(data,c.after)) throw new Error(`Curation changed; rebase the plan: ${c.sourceId}`)
  return data
}))
for (let i = 0; i < plan.changes.length; i++) {
  const c = plan.changes[i], snapshot = snapshots[i]
  // A prior partial run may already have applied (or restored) this exact entry.
  if (matches(snapshot,c.after)) {
    journal.changes.push({ sourceId: c.sourceId, state: 'already-matches', values: curated(snapshot) }); save()
    continue
  }
  // Persist before-values BEFORE the network request; ambiguous requests can be reconciled.
  const entry = { sourceId: c.sourceId, before: curated(snapshot), after: c.after, state: 'prepared' }
  journal.changes.push(entry); save()
  if (mode !== 'dry-run') {
    // A replacement endpoint must earn its own live health; neither the old
    // endpoint's success nor a historic failure streak describes it.
    const resetHealth = c.before.url !== c.after.url || (!c.before.enabled && c.after.enabled)
      ? { consecutive_failures: 0, last_ok_at: null, last_error: null, last_error_kind: null, last_via: null } : {}
    const { data, error } = await db.from('sources').update({ ...c.after, ...resetHealth, updated_at: new Date().toISOString() })
      .eq('id',c.sourceId).eq('updated_at',snapshot.updated_at).select('id')
    if (error || data?.length !== 1) throw new Error(`Curation write failed or snapshot changed: ${c.sourceId}; inspect the journal before retrying`)
    entry.state = 'applied'; save()
  }
}
console.log(`${mode}: ${plan.changes.length} reviewed source changes; historical articles untouched`)
