// src/lib/server/supabase.ts
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SECRET_KEY } from './env'

// Privileged (RLS-bypassing) client — server only, never expose to browser.
// SUPABASE_SECRET_KEY is the modern `sb_secret_...` key (replaces legacy service_role).
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false }
})
