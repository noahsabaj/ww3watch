// Run through source-curation.yml, serialized with ingestion. Default is dry-run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types'
import { sourceAudit } from '../../src/lib/data/source-audit'
import { reversePlan, validatePlan, type RosterPlan, type Probe } from './roster-plan'
import { executeRoster, type JournalEntry } from './execute-roster'

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
const journal: { plan: string; mode: string; startedAt: string; changes: JournalEntry[] } = { plan: plan.id, mode, startedAt: new Date().toISOString(), changes: [] }
mkdirSync('.tmp/source-audit',{ recursive: true })
await executeRoster(plan, mode === 'dry-run', {
  async read(id) {
    const { data, error } = await db.from('sources').select('*').eq('id', id).single()
    if (error || !data) throw new Error(`Source unavailable: ${id}`)
    return data
  },
  async compareAndSet(id, observedUpdatedAt, after, resetHealth) {
    const { data, error } = await db.from('sources').update({ ...after, ...resetHealth, updated_at: new Date().toISOString() })
      .eq('id', id).eq('updated_at', observedUpdatedAt).select('id')
    if (error) throw new Error(`Curation request failed: ${id}; inspect the journal before retrying`)
    return data?.length === 1
  },
}, entries => {
  journal.changes = entries
  writeFileSync('.tmp/source-audit/curation-journal.json', JSON.stringify(journal, null, 2) + '\n')
})
console.log(`${mode}: ${plan.changes.length} reviewed source changes; historical articles untouched`)
