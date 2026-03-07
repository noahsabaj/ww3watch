import { callLLM } from '$lib/server/llm'
import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

const MAX_CONTENT_CHARS = 12000

export const POST: RequestHandler = async ({ request }) => {
  const { title, content, lang } = await request.json()

  const truncated = typeof content === 'string' ? content.slice(0, MAX_CONTENT_CHARS) : ''

  const systemPrompt = `Translate the following article from language code "${lang}" to English.
Return ONLY a JSON object with two fields: "title" (string) and "content" (string).
If the content contains HTML tags, preserve all HTML tags exactly as-is — only translate the visible text between tags.
No markdown, no explanation, no wrapping.`

  let clean: string
  try {
    clean = await callLLM(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ title, content: truncated }) },
      ],
      6000,
    )
  } catch (err) {
    console.error('[translate] LLM call failed:', err)
    return json({ error: 'LLM call failed' }, { status: 500 })
  }

  let parsed: { title?: string; content?: string }
  try {
    parsed = JSON.parse(clean)
  } catch {
    console.error('[translate] JSON.parse failed, raw response:', clean.slice(0, 500))
    return json({ error: 'Failed to parse translation response' }, { status: 500 })
  }

  if (!parsed.title || !parsed.content) {
    console.error('[translate] Missing fields, parsed:', JSON.stringify(parsed).slice(0, 200))
    return json({ error: 'Incomplete translation response' }, { status: 500 })
  }

  return json({ title: parsed.title, content: parsed.content })
}
