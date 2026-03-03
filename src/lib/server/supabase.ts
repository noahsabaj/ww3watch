// src/lib/server/supabase.ts
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'

// Service role client — server only, never expose to browser
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})
