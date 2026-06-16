// Supabase Edge Function: in-panel translation (Deno).
// Translates an article from its source language into the caller's chosen
// reading language (default English) via the OpenAI-compatible LLM (Cerebras),
// caching results in public.article_translations so identical inputs never
// re-burn LLM quota. Current clients send plain text and render the result as
// text; older cached PWA clients may still send HTML, which they sanitize
// client-side with DOMPurify before rendering.
//
// verify_jwt is off, so the abuse control is the articles.url gate + per-IP rate
// limiting (see _shared/ratelimit.ts).

import { corsHeaders, json } from '../_shared/http.ts'
import { serviceClient } from '../_shared/client.ts'
import { rateLimited, tooLarge } from '../_shared/ratelimit.ts'
import { sha256Hex } from '../_shared/hash.ts'
import { isSupportedTarget, translationCacheParts, LANG_NAMES } from '../_shared/lang.ts'

const supabase = serviceClient()

const LLM_BASE_URL = Deno.env.get('LLM_BASE_URL')!
const LLM_API_KEY = Deno.env.get('LLM_API_KEY')!
const LLM_MODEL = Deno.env.get('LLM_MODEL')!

// Plain-text regime (the client sends extracted text, not HTML). 8000 chars
// keeps worst-case output (e.g. CJK target) under max_tokens — at 12000 a
// dense-script translation could exceed the cap and fail deterministically.
const MAX_CONTENT_CHARS = 8000
// Each uncached call burns LLM quota; 20/h is far beyond human reading pace.
const RATE_LIMIT_PER_HOUR = 20

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // Bound the request body before reading the article row / hashing.
  const big = tooLarge(req)
  if (big) return big

  let body: { title?: unknown; content?: unknown; lang?: unknown; url?: unknown; target?: unknown }
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

  // Target reading language. Absent → 'en' (deploy skew: N-1 clients send no
  // target, so they keep getting English). Present-but-unknown → 400: never
  // interpolate a raw client value into the prompt, and keep cache cardinality
  // bounded to the allowlist.
  const target = typeof body.target === 'string' ? body.target : 'en'
  if (!isSupportedTarget(target)) return json({ error: 'unsupported_target' }, 400)

  // No-op when the article is already in the reading language (the client also
  // hides the button) — echo the input, no LLM call.
  if (lang === target) return json({ title, content, untranslated: true })

  const limited = await rateLimited(supabase, req, 'translate', RATE_LIMIT_PER_HOUR)
  if (limited) return limited

  // Gate: must reference an article the pipeline ingested.
  const { data: known, error: gateError } = await supabase
    .from('articles')
    .select('url')
    .eq('url', url)
    .limit(1)
  if (gateError) console.error('[translate] gate lookup failed:', gateError)
  if (!known?.length) return json({ error: 'unknown_article' }, 404)

  // Hash the POST-truncation input (what the LLM actually sees). English keeps
  // the legacy [lang,title,content] formula so the existing English cache is
  // reused; other targets get a distinct namespace (translationCacheParts).
  const truncated = content.slice(0, MAX_CONTENT_CHARS)
  const inputHash = await sha256Hex(translationCacheParts(lang, target, title, truncated))

  const { data: cached } = await supabase
    .from('article_translations')
    .select('title, content')
    .eq('input_hash', inputHash)
    .maybeSingle()
  if (cached) return json({ title: cached.title, content: cached.content, cached: true })

  // The conditional HTML clause stays for deploy skew: PWA autoUpdate means old
  // cached clients keep sending HTML for a session+ after this ships.
  const systemPrompt = `Translate the following article from language code "${lang}" to ${LANG_NAMES[target]}.
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
    { input_hash: inputHash, title: parsed.title, content: parsed.content, target_lang: target },
    { onConflict: 'input_hash', ignoreDuplicates: true },
  )
  if (cacheError) console.error('[translate] cache write failed:', cacheError)

  return json({ title: parsed.title, content: parsed.content })
})
