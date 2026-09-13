// Supabase Edge Function: in-panel translation (Deno).
// Translates an article from its source language into the caller's chosen
// reading language (default English) via the OpenAI-compatible LLM configured
// in LLM_* (synced from the repo's secrets by deploy-functions.yml), caching
// results in public.article_translations so identical inputs never re-burn LLM
// quota.
//
// Two request modes:
//  - SEGMENT mode (current client): { title, segments: string[] } — the client
//    extracts the article's text blocks, we translate each, and the client
//    re-inserts the translations into the ORIGINAL DOM so images/structure stay.
//    The LLM only ever sees plain text and returns an index-keyed JSON object
//    (parsed tolerantly — missing keys keep the original), so it never emits
//    load-bearing structure.
//  - PLAIN mode: { title, content: string } — a single plain-text blob in,
//    { title, content } out. The feed card's headline+summary translation and
//    the reader's failed-extraction fallback both use it (and N-1 cached PWA
//    clients still send it as the legacy shape). A SHORT plain request — judged
//    by size, never by a client flag — draws on a separate, larger rate-limit
//    bucket because it costs a few hundred tokens, not a few thousand.
//
// verify_jwt is off, so the abuse control is the articles.url gate + per-IP rate
// limiting (see _shared/ratelimit.ts).

import { corsHeaders, json } from '../_shared/http.ts'
import { serviceClient } from '../_shared/client.ts'
import { rateLimited, tooLarge } from '../_shared/ratelimit.ts'
import { sha256Hex } from '../_shared/hash.ts'
import { isSupportedTarget, translationCacheParts, LANG_NAMES } from '../_shared/lang.ts'
import { countEchoed, selectWithinBudget, outputTokenBudget, isShortRequest } from '../_shared/segments.ts'

const supabase = serviceClient()

const LLM_BASE_URL = Deno.env.get('LLM_BASE_URL')!
const LLM_API_KEY = Deno.env.get('LLM_API_KEY')!
const LLM_MODEL = Deno.env.get('LLM_MODEL')!
// gpt-oss-class models think before answering and that spend comes out of
// max_tokens; the pipeline runs them at 'low' for the same reason. Unset for
// providers/models that don't take the parameter (a 400 also degrades to a
// bare request below, so a wrong value can't take translation down).
const LLM_REASONING_EFFORT = Deno.env.get('LLM_REASONING_EFFORT') || null

// Plain-text cap. 8000 chars keeps worst-case output under the token ceiling.
const MAX_CONTENT_CHARS = 8000
// Segment-mode bounds.
//
// The real ceiling is the OUTPUT token budget (outputTokenBudget, ≤8000), not a
// count of segments. The old 100-segment cap was a poor proxy for it in both
// directions: it silently cut long articles in half, while 100 large segments
// could still overrun the budget and come back finish_reason=length — a hard
// failure.
//
// So budget CHARACTERS instead, sized for the worst case rather than English:
// 8000 output tokens is roughly 30k characters of Latin script but only ~12-16k
// of Arabic, Persian or CJK, and the JSON envelope costs another ~10%. Segments
// past the budget are ECHOED verbatim, never dropped, so the client can splice
// 1:1 and say how much was left untranslated.
//
// A provider's per-REQUEST token cap (free tiers pre-check tokens-per-minute
// against the whole request) can sit below this budget; a 413 halves it and
// retries, so a long article degrades to "partly translated, remainder
// reported" instead of "failed" — see BUDGET_SHRINK_ATTEMPTS.
const MAX_TRANSLATE_CHARS = 12_000
const MAX_SEGMENT_CHARS = 8000
const BUDGET_SHRINK_ATTEMPTS = 3
const MAX_BODY_BYTES = 200 * 1024
// Transient LLM errors (429/5xx, network blips) fail in ~300ms; retry a few
// times with backoff so a single transient blip doesn't surface as "failed".
const LLM_ATTEMPTS = 3
// Each uncached call burns LLM quota. A full article at 20/h is far beyond
// human reading pace; a headline+summary is ~1/20th the tokens, and a reader
// scanning a feed of foreign-language cards translates dozens, so it gets its
// own bucket — otherwise 20 card taps would lock the reader out of the panel.
const RATE_LIMIT_PER_HOUR = 20
const SHORT_RATE_LIMIT_PER_HOUR = 120

type LLMResult = { text: string } | { error: 'too_large' | 'failed' }

// Matches the provider phrasings for "this single request exceeds a token cap"
// when they come back as a 400 rather than a 413 (context length, TPM pre-check).
const TOO_LARGE_RE = /too large|context[_ ]length|maximum context|too many tokens|tokens? per minute/i

// One LLM round-trip with json_object mode + reasoning_effort (degrading once
// to a bare request on a 400), retried on TRANSIENT failures only (network/
// timeout, 429, 5xx, empty body). Deterministic failures (length truncation,
// non-400 4xx) don't retry. A request the provider refuses for SIZE is reported
// as such so the caller can shrink and try again; nothing else is retried
// deterministically.
async function runLLM(systemPrompt: string, userContent: string, maxTokens: number): Promise<LLMResult> {
  const call = (extras: boolean) =>
    fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0,
        max_tokens: maxTokens,
        ...(extras ? { response_format: { type: 'json_object' } } : {}),
        ...(extras && LLM_REASONING_EFFORT ? { reasoning_effort: LLM_REASONING_EFFORT } : {}),
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
        // Either the model rejects response_format/reasoning_effort, or the
        // request itself is oversized — only the bare retry tells them apart.
        const body = await res.text().catch(() => '')
        if (TOO_LARGE_RE.test(body)) {
          console.error('[translate] request too large (400):', body.slice(0, 300))
          return { error: 'too_large' }
        }
        console.error('[translate] extras rejected (400), retrying bare:', body.slice(0, 300))
        res = await call(false)
      }
    } catch (err) {
      console.error(`[translate] LLM fetch failed (attempt ${attempt + 1}):`, err)
      if (!last) await sleep(500 * (attempt + 1)) // network/timeout → transient
      continue
    }

    if (!res.ok) {
      // The body names the actual limit ("insufficient balance", "TPM: Limit X,
      // Requested Y"); the status alone left the last outage undiagnosable.
      const body = await res.text().catch(() => '')
      console.error(`[translate] LLM status ${res.status} (attempt ${attempt + 1}):`, body.slice(0, 300))
      if (res.status === 413 || (res.status === 400 && TOO_LARGE_RE.test(body))) return { error: 'too_large' }
      if ((res.status === 429 || res.status >= 500) && !last) {
        // Honor Retry-After on a 429 (capped at 4s) so retries actually escape a
        // brief rate-limit window instead of hammering it; else linear backoff.
        const ra = Number(res.headers.get('Retry-After'))
        await sleep(res.status === 429 && ra > 0 ? Math.min(ra, 4) * 1000 : 500 * (attempt + 1))
        continue
      }
      return { error: 'failed' } // non-retryable 4xx, or out of attempts
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
      return { error: 'failed' } // deterministic at temp 0 — retrying won't help
    }
    const raw = (data.choices?.[0]?.message?.content ?? '')
      .trim()
      .replace(/^```[a-z]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim()
    if (raw) return { text: raw }
    if (!last) await sleep(500 * (attempt + 1)) // empty content → retry
  }
  return { error: 'failed' }
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

  // Mode: SEGMENT if a segments array is present, else PLAIN text.
  const segMode = Array.isArray(body.segments)
  // Every segment is kept — the request body is already bounded by MAX_BODY_BYTES,
  // and the output array must stay index-aligned with the input so the client can
  // splice 1:1. Which ones are actually SENT is decided by the budget below.
  const inSegments: string[] = segMode
    ? (body.segments as unknown[]).map((s) => (typeof s === 'string' ? s : ''))
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

  const short = !segMode && isShortRequest(title, content!)
  const limited = short
    ? await rateLimited(supabase, req, 'translate_short', SHORT_RATE_LIMIT_PER_HOUR)
    : await rateLimited(supabase, req, 'translate', RATE_LIMIT_PER_HOUR)
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
          return json({ title: cached.title, segments: segs, cached: true, untranslated: countEchoed(inSegments, segs) })
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

    // Choose what fits the output budget, keeping ORIGINAL indices so the reply
    // stays index-aligned with inSegments. Everything not chosen is echoed. If
    // the provider refuses the request for size, halve the budget and retry:
    // partial-with-a-notice beats a hard failure on a long article.
    let budget = MAX_TRANSLATE_CHARS
    let sendIdx: number[] = []
    let result: LLMResult = { error: 'failed' }
    for (let shrink = 0; shrink < BUDGET_SHRINK_ATTEMPTS; shrink++) {
      sendIdx = selectWithinBudget(inSegments, budget, MAX_SEGMENT_CHARS)
      const userContent = `title: ${title}\n` + sendIdx.map((i) => `${i}: ${inSegments[i]}`).join('\n')
      result = await runLLM(systemPrompt, userContent, outputTokenBudget(userContent.length))
      if (!('error' in result) || result.error !== 'too_large' || sendIdx.length === 0) break
      budget = Math.floor(budget / 2)
      console.error(`[translate] shrinking segment budget to ${budget} chars`)
    }
    if ('error' in result) return json({ error: 'translation_failed' }, 502)
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(result.text)
    } catch {
      return json({ error: 'translation_failed' }, 502)
    }
    // Align to the input by index. A missing/non-string key keeps the original;
    // anything outside the budget is echoed UNTRANSLATED (never a truncated
    // translation spliced over the full original — that would delete the tail).
    const outTitle = typeof obj.title === 'string' && obj.title.trim() ? obj.title : title
    let translatedCount = 0
    const outSegments = inSegments.map((orig, i) => {
      const t = obj[String(i)]
      if (typeof t === 'string' && t.trim()) {
        translatedCount++
        return t
      }
      return orig
    })
    // Reject a mostly-empty (broken/partial) response instead of caching it for
    // 30 days — fail so the next open re-translates. Judged against what was
    // actually SENT, not the whole article: deliberately-echoed overflow is not
    // the model failing.
    if (sendIdx.length > 0 && translatedCount < sendIdx.length * 0.5) {
      console.error(`[translate] partial segment response (${translatedCount}/${sendIdx.length}) — not caching`)
      return json({ error: 'translation_failed' }, 502)
    }

    // ignoreDuplicates:false so a re-translation can heal a corrupt/poisoned row
    // (translation is deterministic per input_hash, so overwriting is safe).
    const { error: cacheError } = await supabase.from('article_translations').upsert(
      { input_hash: inputHash, title: outTitle, content: JSON.stringify(outSegments), target_lang: target },
      { onConflict: 'input_hash', ignoreDuplicates: false },
    )
    if (cacheError) console.error('[translate] cache write failed:', cacheError)
    // How much of the article did NOT get translated, so the reader can be told
    // rather than served a silently half-English page.
    return json({ title: outTitle, segments: outSegments, untranslated: countEchoed(inSegments, outSegments) })
  }

  // PLAIN-text mode. The HTML clause stays for N-1 clients that still send HTML
  // for a session after a deploy.
  const systemPrompt = `Translate the following article from language code "${lang}" to ${targetName}.
Return ONLY a JSON object with two fields: "title" (string) and "content" (string).
If the content contains HTML tags, preserve all HTML tags exactly as-is — only translate the visible text between tags.
Otherwise the content is plain-text paragraphs separated by blank lines — keep the same paragraph breaks.
No markdown, no explanation, no wrapping.`
  const userContent = JSON.stringify({ title, content })

  const result = await runLLM(systemPrompt, userContent, outputTokenBudget(userContent.length))
  if ('error' in result) return json({ error: 'translation_failed' }, 502)
  let parsed: { title?: unknown; content?: unknown }
  try {
    parsed = JSON.parse(result.text)
  } catch {
    console.error('[translate] JSON parse failed:', result.text.slice(0, 200))
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
