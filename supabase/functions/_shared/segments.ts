// Segment budgeting for the translator.
//
// The ceiling that actually binds is max_tokens on the LLM's OUTPUT, not a count
// of segments. An earlier 100-segment cap was a poor proxy in both directions:
// it silently halved long articles, while 100 large segments could still overrun
// the budget and come back finish_reason=length, which is a hard failure rather
// than a partial one.
//
// Lives in _shared/ rather than inline in translate/index.ts because that file
// calls Deno.serve at import time and pulls npm dependencies, so nothing in it
// can be imported by a test — which is how the cap's documented behaviour
// ("echoed UNTRANSLATED") drifted from what it did (dropped) without anyone
// noticing.

/**
 * Indices of the segments that fit the character budget, in order.
 *
 * Original indices are preserved so the LLM's index-keyed reply stays aligned
 * with the full input array: everything not selected is echoed verbatim by the
 * caller, never dropped, so the client can splice 1:1 and report the remainder.
 *
 * Stops at the first segment that doesn't fit rather than skipping it and
 * continuing — an article translated up to a point and then resuming later would
 * read as though the middle had been deleted.
 */
export function selectWithinBudget(
  segments: string[],
  maxTotalChars: number,
  maxSegmentChars: number,
): number[] {
  const chosen: number[] = []
  let remaining = maxTotalChars
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    // Blank and oversized segments are skipped, not stopped on: they are echoed
    // either way and shouldn't cut the article short.
    if (!s.trim() || s.length > maxSegmentChars) continue
    if (s.length > remaining) break
    remaining -= s.length
    chosen.push(i)
  }
  return chosen
}

/**
 * Segments that came back byte-identical to their original — echoed rather than
 * translated. Recomputed instead of stored so a cache hit reports the same
 * number as a fresh translation without needing a column for it.
 *
 * A paragraph that legitimately translates to itself (a bare number, a name)
 * counts here too. Over-reporting by a line is the harmless direction for a
 * "not all of this was translated" notice; under-reporting would let a
 * half-translated article pass as complete.
 */
export function countEchoed(input: string[], output: string[]): number {
  let n = 0
  for (let i = 0; i < input.length; i++) {
    if (input[i].trim() && output[i] === input[i]) n++
  }
  return n
}

// ── Output budget ───────────────────────────────────────────────────────────
// Providers that pre-check tokens-per-minute count max_tokens as REQUESTED
// tokens, so a fixed 8000 made every call — a 30-character headline included —
// look like an 8k-token request and bounce off an 8k TPM tier with a 413. Size
// the ceiling to the input instead: a translation is about as long as its
// source, and 2 chars/token is a worst case for non-Latin targets, so
// chars/2 is a generous output estimate. The floor covers the JSON envelope and
// a reasoning model's hidden thinking tokens, which draw from the same budget.
export const MAX_OUTPUT_TOKENS = 8000
export const MIN_OUTPUT_TOKENS = 512

export function outputTokenBudget(inputChars: number): number {
  return Math.min(MAX_OUTPUT_TOKENS, MIN_OUTPUT_TOKENS + Math.ceil(Math.max(0, inputChars) / 2))
}

// ── Short requests ──────────────────────────────────────────────────────────
// A headline + summary (the feed card's translate control, and the reader's
// fallback when extraction fails) costs a few hundred tokens — a different
// order of magnitude from a full article. Judged by SIZE, not a client flag,
// so the cheaper bucket can't be claimed for an expensive request.
export const SHORT_TITLE_CHARS = 400
export const SHORT_CONTENT_CHARS = 1500

export function isShortRequest(title: string, content: string): boolean {
  return title.length <= SHORT_TITLE_CHARS && content.length <= SHORT_CONTENT_CHARS
}
