import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, LLM_MAX_RPM, LLM_REASONING_EFFORT } from './env'

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

// Where the run's wall-clock actually goes. None of this was observable before,
// which is why 19 minutes of rate-limit backoff looked like a silent hang: the
// limiter sleeps and the 429 retries never logged anything. Recorded into
// pipeline_runs.stats.llm so the next tuning decision comes from data.
export interface LlmStats {
  calls: number // successful round-trips
  attempts: number // including retries
  rateLimited: number // 429 responses
  limiterWaitMs: number // time spent waiting for a rate-limiter slot
  backoffMs: number // time spent in 429 backoff
  requestMs: number // time spent awaiting the provider
  deadlineSkips: number // calls refused because the run was out of budget
  /**
   * The first 429 of the run, verbatim: which limit, which window, how much
   * headroom. The counters alone cannot distinguish a requests-per-minute cap
   * from a token bucket — run 474 had to infer "token bucket, retry-after
   * >= 485s" from the deadline-guard arithmetic because this was discarded.
   * pipeline_runs has RLS on with zero policies (service-role only), so the
   * provider's message is not published by recording it.
   */
  rateLimitNote: string | null
  /** Largest backoff the provider asked for, ms. Sizes the run budget. */
  maxRetryAfterMs: number
}

const EMPTY_STATS: LlmStats = {
  calls: 0,
  attempts: 0,
  rateLimited: 0,
  limiterWaitMs: 0,
  backoffMs: 0,
  requestMs: 0,
  deadlineSkips: 0,
  rateLimitNote: null,
  maxRetryAfterMs: 0,
}

export const llmStats: LlmStats = { ...EMPTY_STATS }

// Reset from a literal rather than zeroing every key: `rateLimitNote` is a
// string, and the old Object.keys loop would have quietly set it to 0.
export function resetLlmStats(): void {
  Object.assign(llmStats, EMPTY_STATS)
}

/** Provider rate-limit detail, flattened for pipeline_runs.stats. */
function describeRateLimit(res: Response, body: string): string {
  const headers = [
    'retry-after',
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests',
    'x-ratelimit-limit-tokens',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-reset-tokens',
  ]
    .map((k) => {
      const v = res.headers.get(k)
      return v ? `${k}=${v}` : null
    })
    .filter(Boolean)
    .join(' ')
  // The body carries the sentence that names the limit ("...on tokens per day
  // (TPD): Limit X, Used Y, Requested Z"), which no header does.
  return [headers || null, body.trim().slice(0, 300) || null].filter(Boolean).join(' | ')
}

/** Thrown when a call cannot start (or retry) inside the run's remaining budget. */
export class LLMDeadlineError extends Error {
  constructor() {
    super('llm_deadline')
    this.name = 'LLMDeadlineError'
  }
}

function acquireSlot(deadlineMs?: number): Promise<void> {
  const prev = gate
  let release!: () => void
  gate = new Promise<void>((r) => (release = r))
  return prev.then(async () => {
    try {
      // Never pay the rate-limit interval for a caller that will be refused the
      // instant it wakes. Batches queue on this gate BEFORE the deadline and can
      // reach the front after it; sleeping for each would turn N waiting batches
      // into N × MIN_INTERVAL of dead time spent entirely past the budget —
      // which would put the run back on course for the job timeout this whole
      // deadline exists to avoid. Releasing immediately drains the queue at once.
      if (deadlineMs !== undefined && Date.now() >= deadlineMs) return
      const wait = lastStart + MIN_INTERVAL_MS - Date.now()
      if (wait > 0) {
        llmStats.limiterWaitMs += wait
        await sleep(wait)
      }
      lastStart = Date.now()
    } finally {
      release()
    }
  })
}

const MAX_RETRIES = 4

/**
 * One LLM round-trip, rate-limited and 429-retried.
 *
 * `deadlineMs` is an absolute wall-clock epoch past which this call will not
 * START (nor retry), throwing LLMDeadlineError instead. Without it the retry
 * budget is denominated in ATTEMPTS while the job budget is wall-clock, and
 * nothing relates the two: at MAX_RETRIES=4 and MIN_INTERVAL 30s, ten
 * concurrent batches can queue 50 slot acquisitions — 25 minutes — against a
 * 20-minute job. That is exactly how 38 of 40 scheduled runs died inside
 * classify without reaching a single insert.
 */
export async function callLLM(
  messages: LLMMessage[],
  maxTokens: number,
  deadlineMs?: number,
): Promise<string> {
  const outOfTime = () => deadlineMs !== undefined && Date.now() >= deadlineMs
  for (let attempt = 0; ; attempt++) {
    if (outOfTime()) {
      llmStats.deadlineSkips++
      throw new LLMDeadlineError()
    }
    await acquireSlot(deadlineMs)
    // The slot wait itself can be minutes — re-check rather than starting a
    // request the run has no time left to use.
    if (outOfTime()) {
      llmStats.deadlineSkips++
      throw new LLMDeadlineError()
    }

    llmStats.attempts++
    const startedAt = Date.now()
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
        ...(LLM_REASONING_EFFORT ? { reasoning_effort: LLM_REASONING_EFFORT } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    })

    llmStats.requestMs += Date.now() - startedAt

    // Rate limited: back off and retry instead of failing (which would drop the
    // batch to a degraded fallback). Honor Retry-After when present.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      llmStats.rateLimited++
      const retryAfter = Number(res.headers.get('retry-after'))
      const backoff =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 1000 * 2 ** attempt)
      llmStats.maxRetryAfterMs = Math.max(llmStats.maxRetryAfterMs, backoff)
      // Capture once per run. Reading the body consumes it, and nothing below
      // this point uses it on the 429 path.
      if (llmStats.rateLimitNote === null) {
        llmStats.rateLimitNote = describeRateLimit(res, await res.text().catch(() => ''))
      }
      // Don't sleep past the run's budget just to start a call that will then be
      // refused — give the time back to the stages that still have work to do.
      if (deadlineMs !== undefined && Date.now() + backoff >= deadlineMs) {
        llmStats.deadlineSkips++
        throw new LLMDeadlineError()
      }
      console.warn(`[llm] 429 (attempt ${attempt + 1}/${MAX_RETRIES + 1}), backing off ${backoff}ms`)
      llmStats.backoffMs += backoff
      await sleep(backoff)
      continue
    }

    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`)

    llmStats.calls++
    const data = await res.json()
    const text: string = data.choices?.[0]?.message?.content?.trim() ?? ''
    return text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim()
  }
}
