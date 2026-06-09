// Supabase Edge Function: in-panel translation to English (Deno).
// Ports src/routes/api/translate/+server.ts. Calls the OpenAI-compatible LLM
// (Cerebras) and validates input. Reads LLM config from edge-function secrets.
//
// The returned HTML is sanitized on the CLIENT with DOMPurify before rendering
// (see ArticlePanel + src/lib/sanitize-html.ts).
//
// Self-contained (cors inlined) so it deploys as a single file.

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

const LLM_BASE_URL = Deno.env.get('LLM_BASE_URL')!
const LLM_API_KEY = Deno.env.get('LLM_API_KEY')!
const LLM_MODEL = Deno.env.get('LLM_MODEL')!

const MAX_CONTENT_CHARS = 12000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: { title?: unknown; content?: unknown; lang?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const { title, content, lang } = body
  if (typeof title !== 'string' || typeof content !== 'string' || typeof lang !== 'string') {
    return json({ error: 'invalid_body' }, 400)
  }

  const truncated = content.slice(0, MAX_CONTENT_CHARS)
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

  return json({ title: parsed.title, content: parsed.content })
})
