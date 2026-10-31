// src/lib/server/supabase.ts
import { createClient } from '@supabase/supabase-js'
import type { AppDatabase } from '../db'
import { SUPABASE_URL, SUPABASE_SECRET_KEY } from './env'
import { productionWriteRefusal } from './write-guard'
import { meteredFetch } from './egress'

const refusal = productionWriteRefusal(SUPABASE_URL, process.env)
if (refusal) throw new Error(refusal)

// Privileged (RLS-bypassing) client — server only, never expose to browser.
// SUPABASE_SECRET_KEY is the modern `sb_secret_...` key (replaces legacy service_role).
// Every response is counted (egress.ts), so a run can record what it read.
export const supabaseAdmin = createClient<AppDatabase>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
  global: { fetch: meteredFetch },
})
