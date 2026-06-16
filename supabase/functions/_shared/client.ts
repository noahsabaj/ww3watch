import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

// Service client from Supabase's auto-injected env: prefer the new secret-keys
// dict, fall back to the legacy service-role key.
function secretKey(): string {
  const dict = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (dict) {
    try {
      const parsed = JSON.parse(dict)
      if (typeof parsed?.default === 'string') return parsed.default
    } catch {
      // fall through
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false },
  })
}
