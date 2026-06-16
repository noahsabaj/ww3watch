// Supabase Edge Function: in-panel translation (Deno).
// Translates an article from its source language into the caller's chosen
// reading language (default English) via the OpenAI-compatible LLM (Cerebras),
// caching results in public.article_translations so identical inputs never
// re-burn LLM quota.
//
// Two request modes:
//  - SEGMENT mode (current client): { title, segments: string[] } — the client
//    extracts the article's text blocks, we translate each, and the client
//    re-inserts the translations into the ORIGINAL DOM so images/structure stay.
//    The LLM only ever sees plain text and returns an index-keyed JSON object
//    (parsed tolerantly — missing keys keep the original), so it never emits
//    load-bearing structure.
//  - LEGACY mode (N-1 cached PWA clients): { title, content: string } — a single
//    plain-text blob in, { title, content } out.
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

// Legacy plain-text cap. 8000 chars keeps worst-case output under max_tokens.
const MAX_CONTENT_CHARS = 8000
// Segment-mode bounds. Segments beyond MAX_SEGMENTS, or longer than
// MAX_SEGMENT_CHARS, are echoed UNTRANSLATED (never spliced as a partial) — the
// segment regime needs more total room than legacy, so the body cap is larger.
const MAX_SEGMENTS = 100
const MAX_SEGMENT_CHARS = 8000
const MAX_BODY_BYTES = 200 * 1024
// Transient LLM errors (Cerebras 429/5xx, network blips) fail in ~300ms; retry a
// few times with backoff so a single transient blip doesn't surface as "failed".
const LLM_ATTEMPTS = 3
// Each uncached call burns LLM quota; 20/h is far beyond human reading pace.
const RATE_LIMIT_PER_HOUR = 20

// One LLM round-trip with json_object mode (degrading once to free-form on a 400),
// retried on TRANSIENT failures only (network/timeout, 429, 5xx, empty body).
// Deterministic failures (length truncation, non-400 4xx) don't retry. Returns
// the cleaned response text, or null after exhausting attempts.
async function runLLM(systemPrompt: string, userContent: string): Promise<string | null> {
  const call = (jsonMode: boolean) =>
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
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    })

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  for (let attempt = 0; attempt < LLM_ATTEMPTS; attempt++) {
    const last = attempt === LLM_ATTEMPTS - 1

    let res: Response
    try {
      res = await call(true)
      if (res.status === 400) {
        console.error('[translate] response_format rejected (400), retrying without')
        res = await call(false)
      }
    } catch (err) {
      console.error(`[translate] LLM fetch failed (attempt ${attempt + 1}):`, err)
      if (!last) await sleep(500 * (attempt + 1)) // network/timeout → transient
      continue
    }

    if (!res.ok) {
      console.error(`[translate] LLM status ${res.status} (attempt ${attempt + 1})`)
      if ((res.status === 429 || res.status >= 500) && !last) {
        // Honor Retry-After on a 429 (capped at 4s) so retries actually escape a
        // brief rate-limit window instead of hammering it; else linear backoff.
        const ra = Number(res.headers.get('Retry-After'))
        await sleep(res.status === 429 && ra > 0 ? Math.min(ra, 4) * 1000 : 500 * (attempt + 1))
        continue
      }
      return null // non-retryable 4xx, or out of attempts
    }

    let data: { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> }
    try {
      data = await res.json()
    } catch {
      if (!last) await sleep(500 * (attempt + 1)) // malformed transport → retry
      continue
    }
    if (data.choices?.[0]?.finish_reason === 'length') {
      console.error('[translate] output truncated at max_tokens')
      return null // deterministic at temp 0 — retrying won't help
    }
    const raw = (data.choices?.[0]?.message?.content ?? '')
      .trim()
      .replace(/^```[a-z]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim()
    if (raw) return raw
    if (!last) await sleep(500 * (attempt + 1)) // empty content → retry
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // Bound the request body before reading the article row / hashing. Segment
  // mode legitimately ships an article's worth of text, so allow more than the
  // default — still a hard ceiling against abuse.
  const big = tooLarge(req, MAX_BODY_BYTES)
  if (big) return big

  let body: { title?: unknown; content?: unknown; segments?: unknown; lang?: unknown; url?: unknown; target?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const { title, lang, url } = body
  if (typeof title !== 'string' || typeof lang !== 'string' || typeof url !== 'string') {
    return json({ error: 'invalid_body' }, 400)
  }

  // Mode: SEGMENT if a segments array is present, else LEGACY plain text.
  const segMode = Array.isArray(body.segments)
  // Keep the FULL segment text (sliced only for the LLM prompt below) so an
  // over-cap segment can be echoed untranslated rather than spliced as a partial.
  const inSegments: string[] = segMode
    ? (body.segments as unknown[]).slice(0, MAX_SEGMENTS).map((s) => (typeof s === 'string' ? s : ''))
    : []
  const content = typeof body.content === 'string' ? body.content.slice(0, MAX_CONTENT_CHARS) : null
  if (!segMode && content === null) return json({ error: 'invalid_body' }, 400)

  // Target reading language. Absent → 'en' (deploy skew). Present-but-unknown →
  // 400: never interpolate a raw client value into the prompt; bound cache size.
  const target = typeof body.target === 'string' ? body.target : 'en'
  if (!isSupportedTarget(target)) return json({ error: 'unsupported_target' }, 400)

  // No-op when already in the reading language (the client also hides the button).
  if (lang === target) {
    return segMode
      ? json({ title, segments: inSegments, untranslated: true })
      : json({ title, content, untranslated: true })
  }

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

  // Cache key over what the LLM actually sees. English keeps the legacy formula
  // (cache reuse); other targets / segment mode get distinct namespaces.
  const cacheBody = segMode ? JSON.stringify(inSegments) : content!
  const inputHash = await sha256Hex(translationCacheParts(lang, target, title, cacheBody))

  const { data: cached } = await supabase
    .from('article_translations')
    .select('title, content')
    .eq('input_hash', inputHash)
    .maybeSingle()
  if (cached) {
    if (segMode) {
      try {
        const segs = JSON.parse(cached.content)
        if (Array.isArray(segs) && segs.length === inSegments.length) {
          return json({ title: cached.title, segments: segs, cached: true })
        }
      } catch {
        // corrupt cache row — fall through and re-translate
      }
    } else {
      return json({ title: cached.title, content: cached.content, cached: true })
    }
  }

  const targetName = LANG_NAMES[target]

  if (segMode) {
    const systemPrompt = `Translate each numbered text segment from language code "${lang}" to ${targetName}.
Return ONLY a JSON object whose keys are the segment numbers as strings ("0","1",…) with the translated plain text as values, plus a "title" key holding the translated title.
Translate every segment; output plain text only (no markdown, no HTML, no wrapping). Example: {"title":"…","0":"…","1":"…"}`
    // The LLM only ever sees a per-segment-capped prompt (token safety); the full
    // originals live in inSegments for the echo path below.
    const promptSegments = inSegments.map((s) => s.slice(0, MAX_SEGMENT_CHARS))
    const userContent = `title: ${title}\n` + promptSegments.map((s, i) => `${i}: ${s}`).join('\n')

    const raw = await runLLM(systemPrompt, userContent)
    if (raw === null) return json({ error: 'translation_failed' }, 502)
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(raw)
    } catch {
      return json({ error: 'translation_failed' }, 502)
    }
    // Align to the input by index. A missing/non-string key keeps the original;
    // an over-cap segment is echoed UNTRANSLATED (never a truncated translation
    // spliced over the full original — that would silently delete the tail).
    const outTitle = typeof obj.title === 'string' && obj.title.trim() ? obj.title : title
    let translatedCount = 0
    const outSegments = inSegments.map((orig, i) => {
      if (orig.length > MAX_SEGMENT_CHARS) return orig
      const t = obj[String(i)]
      if (typeof t === 'string' && t.trim()) {
        translatedCount++
        return t
      }
      return orig
    })
    // Reject a mostly-empty (broken/partial) response instead of caching it for
    // 30 days — fail so the next open re-translates.
    const translatable = inSegments.filter((s) => s.trim() && s.length <= MAX_SEGMENT_CHARS).length
    if (translatable > 0 && translatedCount < translatable * 0.5) {
      console.error(`[translate] partial segment response (${translatedCount}/${translatable}) — not caching`)
      return json({ error: 'translation_failed' }, 502)
    }

    // ignoreDuplicates:false so a re-translation can heal a corrupt/poisoned row
    // (translation is deterministic per input_hash, so overwriting is safe).
    const { error: cacheError } = await supabase.from('article_translations').upsert(
      { input_hash: inputHash, title: outTitle, content: JSON.stringify(outSegments), target_lang: target },
      { onConflict: 'input_hash', ignoreDuplicates: false },
    )
    if (cacheError) console.error('[translate] cache write failed:', cacheError)
    return json({ title: outTitle, segments: outSegments })
  }

  // LEGACY plain-text mode. The HTML clause stays for N-1 clients that still send
  // HTML for a session after this deploys.
  const systemPrompt = `Translate the following article from language code "${lang}" to ${targetName}.
Return ONLY a JSON object with two fields: "title" (string) and "content" (string).
If the content contains HTML tags, preserve all HTML tags exactly as-is — only translate the visible text between tags.
Otherwise the content is plain-text paragraphs separated by blank lines — keep the same paragraph breaks.
No markdown, no explanation, no wrapping.`
  const userContent = JSON.stringify({ title, content })

  const raw = await runLLM(systemPrompt, userContent)
  if (raw === null) return json({ error: 'translation_failed' }, 502)
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

  const { error: cacheError } = await supabase.from('article_translations').upsert(
    { input_hash: inputHash, title: parsed.title, content: parsed.content, target_lang: target },
    { onConflict: 'input_hash', ignoreDuplicates: true },
  )
  if (cacheError) console.error('[translate] cache write failed:', cacheError)

  return json({ title: parsed.title, content: parsed.content })
})
