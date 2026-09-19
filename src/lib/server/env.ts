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

// Max LLM requests/minute the pipeline will start (tune to the provider's free
// tier: Groq ~30, Cerebras 5). callLLM also retries 429s with backoff.
export const LLM_MAX_RPM = Math.max(1, Number(process.env.LLM_MAX_RPM ?? '8') || 8)

// Reasoning models (gpt-oss-*) spend completion tokens thinking before they
// answer; 'low' keeps that spend small so tight max_tokens budgets still fit
// the final JSON. Unset by default — non-reasoning models and providers that
// don't know the param (e.g. Cerebras with non-gpt-oss models) would 400 on it.
export const LLM_REASONING_EFFORT = process.env.LLM_REASONING_EFFORT || undefined

export interface LlmProfile {
  baseUrl: string
  apiKey: string
  model: string
  maxRpm: number
  reasoningEffort: string | undefined
}

export const DEFAULT_LLM: LlmProfile = {
  baseUrl: LLM_BASE_URL,
  apiKey: LLM_API_KEY,
  model: LLM_MODEL,
  maxRpm: LLM_MAX_RPM,
  reasoningEffort: LLM_REASONING_EFFORT,
}

// Classification can run on its own provider (CLASSIFY_LLM_*), the same way
// translation can (TRANSLATE_LLM_*). Free tiers cap tokens per DAY, and
// classification is ~all of the pipeline's spend: on a shared key it starves
// trending and is itself capped at ~2,000 verdicts/day. All three of
// BASE_URL / API_KEY / MODEL must be set; otherwise classification uses LLM_*.
// Empty strings count as unset — that is what an undefined GitHub secret is.
const c = {
  baseUrl: process.env.CLASSIFY_LLM_BASE_URL,
  apiKey: process.env.CLASSIFY_LLM_API_KEY,
  model: process.env.CLASSIFY_LLM_MODEL,
}
export const CLASSIFY_LLM: LlmProfile =
  c.baseUrl && c.apiKey && c.model
    ? {
        baseUrl: c.baseUrl,
        apiKey: c.apiKey,
        model: c.model,
        maxRpm: Math.max(1, Number(process.env.CLASSIFY_LLM_MAX_RPM || '') || LLM_MAX_RPM),
        reasoningEffort: process.env.CLASSIFY_LLM_REASONING_EFFORT || LLM_REASONING_EFFORT,
      }
    : DEFAULT_LLM
