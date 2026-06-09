// Runtime env access for the Node ingestion pipeline (GitHub Actions / local).
// NOT used by the static frontend build — the browser uses $env/static/public
// via src/lib/supabase.ts. Reading from process.env keeps these modules
// independent of SvelteKit so scripts/run-pipeline.ts can run them under tsx.

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in your .env (local) or repo secrets (GitHub Actions).`,
    )
  }
  return value
}

export const SUPABASE_URL = required('SUPABASE_URL')
// Modern `sb_secret_...` key (replaces the legacy service_role JWT); bypasses RLS.
export const SUPABASE_SECRET_KEY = required('SUPABASE_SECRET_KEY')
export const LLM_BASE_URL = required('LLM_BASE_URL')
export const LLM_API_KEY = required('LLM_API_KEY')
export const LLM_MODEL = required('LLM_MODEL')
