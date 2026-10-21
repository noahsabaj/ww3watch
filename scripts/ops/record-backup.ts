import { supabaseAdmin as db } from '../../src/lib/server/supabase'
// Every backup counts toward backup_success (the 24-hour tables); a full one
// also refreshes full_backup_success, which operations checks weekly.
const arg = process.argv[2]
const events = arg === 'restore_success' ? ['restore_success'] : arg === 'full_backup_success' ? ['backup_success', 'full_backup_success'] : ['backup_success']
const occurred_at = new Date().toISOString()
const {error} = await db.from('ops_events').upsert(events.map(name=>({name,occurred_at,details:{run:process.env.GITHUB_RUN_ID ?? ''}})))
if(error) throw new Error('Could not record successful backup')
