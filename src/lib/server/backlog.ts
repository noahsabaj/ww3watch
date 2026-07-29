/**
 * Writing off feed items that will never be worth an LLM verdict.
 *
 * The pipeline classifies the newest MAX_CLASSIFY_PER_RUN candidates and defers
 * the rest "to next run". For nine days that sentence was false: judged_total
 * sat at exactly 300/day — one successful run out of ~96 scheduled — so the
 * deferred remainder was never reconsidered, it just accumulated. The feeds hold
 * ~6,290 unique items and 6,007 of them had never been judged at all.
 *
 * Those articles cost real money to keep looking at: every run re-fetches them,
 * re-dedupes them, and re-sorts them, and the only thing standing between them
 * and the LLM is a cap. But an article published days ago cannot surface in a
 * live conflict feed even if a model called it relevant — the feed serves the
 * newest 500. Spending a token budget to discover that is pure waste.
 *
 * So: past a cutoff, deferred items are recorded as rejects with reason='stale'
 * and stop being "new". This is deliberately age-based rather than a one-off
 * cleanup of today's 6,000 — a rule guards the class, a script guards only this
 * instance, and the instance will come back the next time the pipeline stalls.
 */

/** The fields the write-off decision and its reject row actually need. */
export interface BacklogItem {
  guid: string
  title?: string | null
  published_at?: string | null
  source_id?: string | null
  source_lang?: string | null
}

/**
 * Deferred items old enough that a verdict could not change what anyone sees.
 *
 * An item is kept (NOT written off) whenever its age is unknown. rss.ts clamps
 * out-of-range pubDates to null, so a feed with a broken timezone or year emits
 * null for everything it publishes — and null sorts last under the newest-first
 * ordering, which would drop that entire source into this band and silently
 * write off every article it ever produces. Unknown age is not old age.
 *
 * @param deferred items beyond the per-run classify cap, in any order
 * @param cutoffMs epoch before which a published_at counts as too old
 */
export function selectStaleWriteOffs<T extends BacklogItem>(deferred: T[], cutoffMs: number): T[] {
  return deferred.filter((a) => {
    if (!a.published_at) return false
    const t = Date.parse(a.published_at)
    // NaN for an unparseable date — same "unknown, so keep" rule as null.
    return Number.isFinite(t) && t < cutoffMs
  })
}

/** Reject-table row for an unjudged write-off. Mirrors the LLM reject shape. */
export function staleRejectRow(a: BacklogItem): {
  guid: string
  title: string | null
  source_id: string | null
  lang: string | null
  reason: 'stale'
} {
  return {
    guid: a.guid,
    title: a.title ?? null,
    source_id: a.source_id ?? null,
    lang: a.source_lang ?? null,
    reason: 'stale',
  }
}
