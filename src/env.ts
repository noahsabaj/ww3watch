import { defineEnvVars } from '@sveltejs/kit/env'

// The browser's Supabase credentials (publishable by design: they ship in the
// bundle, and RLS is what protects the data). static: inlined at build time, so
// the static site needs no runtime env — and a build without them fails.
export const variables = defineEnvVars({
  PUBLIC_SUPABASE_URL: { public: true, static: true },
  PUBLIC_SUPABASE_ANON_KEY: { public: true, static: true },
})
