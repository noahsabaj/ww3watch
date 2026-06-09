import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_MAX_RPM } from './env'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── Rate limiter ─────────────────────────────────────────────────────────────
// Serialize LLM call *starts* to at least MIN_INTERVAL apart so the pipeline's
// many classify batches don't burst past the provider's requests/minute limit.
// A promise chain acts as an async mutex; each acquirer waits for the previous.
const MIN_INTERVAL_MS = Math.ceil(60_000 / LLM_MAX_RPM)
let gate: Promise<void> = Promise.resolve()
let lastStart = 0

function acquireSlot(): Promise<void> {
  const prev = gate
  let release!: () => void
  gate = new Promise<void>((r) => (release = r))
  return prev.then(async () => {
    try {
      const wait = lastStart + MIN_INTERVAL_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastStart = Date.now()
    } finally {
      release()
    }
  })
}

const MAX_RETRIES = 4

export async function callLLM(messages: LLMMessage[], maxTokens: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    await acquireSlot()

    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(15000),
    })

    // Rate limited: back off and retry instead of failing (which would drop the
    // batch to a degraded fallback). Honor Retry-After when present.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const backoff =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 1000 * 2 ** attempt)
      await sleep(backoff)
      continue
    }

    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)

    const data = await res.json()
    const text: string = data.choices?.[0]?.message?.content?.trim() ?? ''
    return text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
  }
}
