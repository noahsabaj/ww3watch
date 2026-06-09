// Supabase Edge Function: in-panel translation to English (Deno).
// Calls the OpenAI-compatible LLM (Cerebras) and caches results in
// public.article_translations so identical inputs never re-burn LLM quota.
// The returned HTML is sanitized on the CLIENT with DOMPurify before rendering.
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

const MAX_CONTENT_CHARS = 12000

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

  const systemPrompt = `Translate the following article from language code "${lang}" to English.
Return ONLY a JSON object with two fields: "title" (string) and "content" (string).
If the content contains HTML tags, preserve all HTML tags exactly as-is — only translate the visible text between tags.
No markdown, no explanation, no wrapping.`

  let raw: string
  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0,
        max_tokens: 6000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify({ title, content: truncated }) },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      console.error('[translate] LLM status', res.status)
      return json({ error: 'translation_failed' }, 502)
    }
    const data = await res.json()
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
