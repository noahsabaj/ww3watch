// Supabase Edge Function: in-panel translation to English (Deno).
// Calls the OpenAI-compatible LLM (Cerebras) and caches results in
// public.article_translations so identical inputs never re-burn LLM quota.
// Current clients send plain text and render the result as text; older cached
// PWA clients may still send HTML, which they sanitize client-side with
// DOMPurify before rendering.
//
// verify_jwt is off, so the abuse control is the articles.url gate: requests
// must reference a URL the pipeline ingested.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

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
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false },
})

const LLM_BASE_URL = Deno.env.get('LLM_BASE_URL')!
const LLM_API_KEY = Deno.env.get('LLM_API_KEY')!
const LLM_MODEL = Deno.env.get('LLM_MODEL')!

// Plain-text regime (the client sends extracted text, not HTML). 8000 chars
// keeps worst-case output (CJK input → English) under max_tokens — at 12000 a
// Chinese article could exceed the cap and fail deterministically on retry.
const MAX_CONTENT_CHARS = 8000
// Each uncached call burns LLM quota; 20/h is far beyond human reading pace.
const RATE_LIMIT_PER_HOUR = 20

// Per-IP hourly rate limit. Fail-OPEN on limiter errors: a bookkeeping hiccup
// must never take the feature down; the limit exists to stop scripted abuse.
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  return xff?.split(',')[0]?.trim() || 'unknown'
}

function secondsToNextHour(): number {
  const now = new Date()
  return Math.max(1, Math.ceil((3600_000 - (now.getTime() % 3600_000)) / 1000))
}

async function rateLimited(req: Request, fn: string, limit: number): Promise<Response | null> {
  try {
    const { data: allowed, error } = await supabase.rpc('check_rate_limit', {
      p_ip: clientIp(req),
      p_fn: fn,
      p_limit: limit,
    })
    if (error) {
      console.error(`[${fn}] rate-limit check failed (failing open):`, error)
      return null
    }
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(secondsToNextHour()) },
      })
    }
  } catch (err) {
    console.error(`[${fn}] rate-limit check failed (failing open):`, err)
  }
  return null
}


async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: { title?: unknown; content?: unknown; lang?: unknown; url?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const { title, content, lang, url } = body
  if (
    typeof title !== 'string' ||
    typeof content !== 'string' ||
    typeof lang !== 'string' ||
    typeof url !== 'string'
  ) {
    return json({ error: 'invalid_body' }, 400)
  }

  const limited = await rateLimited(req, 'translate', RATE_LIMIT_PER_HOUR)
  if (limited) return limited

  // Gate: must reference an article the pipeline ingested.
  const { data: known, error: gateError } = await supabase
    .from('articles')
    .select('url')
    .eq('url', url)
    .limit(1)
  if (gateError) console.error('[translate] gate lookup failed:', gateError)
  if (!known?.length) return json({ error: 'unknown_article' }, 404)

  // Hash the POST-truncation input (what the LLM actually sees), delimited so
  // (lang,title,content) boundaries are unambiguous.
  const truncated = content.slice(0, MAX_CONTENT_CHARS)
  const inputHash = await sha256Hex([lang, title, truncated].join(String.fromCharCode(31)))

  const { data: cached } = await supabase
    .from('article_translations')
    .select('title, content')
    .eq('input_hash', inputHash)
    .maybeSingle()
  if (cached) return json({ title: cached.title, content: cached.content, cached: true })

  // The conditional HTML clause stays for deploy skew: PWA autoUpdate means old
  // cached clients keep sending HTML for a session+ after this ships.
  const systemPrompt = `Translate the following article from language code "${lang}" to English.
Return ONLY a JSON object with two fields: "title" (string) and "content" (string).
If the content contains HTML tags, preserve all HTML tags exactly as-is — only translate the visible text between tags.
Otherwise the content is plain-text paragraphs separated by blank lines — keep the same paragraph breaks.
No markdown, no explanation, no wrapping.`

  const callLLM = (jsonMode: boolean) =>
    fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0,
        max_tokens: 8000,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ title, content: truncated }) },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    })

  let raw: string
  try {
    let res = await callLLM(true)
    // Some models reject response_format — degrade once to free-form JSON.
    if (res.status === 400) {
      console.error('[translate] response_format rejected (400), retrying without')
      res = await callLLM(false)
    }
    if (!res.ok) {
      console.error('[translate] LLM status', res.status)
      return json({ error: 'translation_failed' }, 502)
    }
    const data = await res.json()
    if (data.choices?.[0]?.finish_reason === 'length') {
      console.error('[translate] output truncated at max_tokens (content chars:', truncated.length, ')')
      return json({ error: 'translation_failed' }, 502)
    }
    raw = (data.choices?.[0]?.message?.content ?? '')
      .trim()
      .replace(/^```[a-z]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim()
  } catch (err) {
    console.error('[translate] LLM call failed:', err)
    return json({ error: 'translation_failed' }, 502)
  }

  let parsed: { title?: unknown; content?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error('[translate] JSON parse failed:', raw.slice(0, 200))
    return json({ error: 'translation_failed' }, 502)
  }
  if (typeof parsed.title !== 'string' || typeof parsed.content !== 'string') {
    return json({ error: 'translation_failed' }, 502)
  }

  // Cache write is best-effort.
  const { error: cacheError } = await supabase.from('article_translations').upsert(
    { input_hash: inputHash, title: parsed.title, content: parsed.content },
    { onConflict: 'input_hash', ignoreDuplicates: true },
  )
  if (cacheError) console.error('[translate] cache write failed:', cacheError)

  return json({ title: parsed.title, content: parsed.content })
})
