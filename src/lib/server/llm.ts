import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL } from '$env/static/private'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function callLLM(messages: LLMMessage[], maxTokens: number): Promise<string> {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      temperature: 0,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(9000),
  })

  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)

  const data = await res.json()
  const text: string = data.choices?.[0]?.message?.content?.trim() ?? ''
  return text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
}
