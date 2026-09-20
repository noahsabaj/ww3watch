import { supabaseAdmin as db } from '../../src/lib/server/supabase'
const event = process.argv[2] === 'restore_success' ? 'restore_success' : 'backup_success'
const {error} = await db.from('ops_events').upsert({name:event,occurred_at:new Date().toISOString(),details:{run:process.env.GITHUB_RUN_ID ?? ''}})
if(error) throw new Error('Could not record successful backup')
