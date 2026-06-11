// Wire-syndication fingerprinting. Outlets that reprint the same agency copy
// (Reuters/AP/AFP…) publish near-verbatim summaries — a hash of the
// normalized text identifies them, so "N sources covered this" can distinguish
// independent reporting from syndication.
//
// THE normalize function: the pipeline (rss.ts) and the backfill script both
// hash through here. Never reimplement it (in SQL or anywhere) — any drift
// silently breaks equality.

import { createHash } from 'node:crypto'

// Lowercase, strip everything that isn't a letter/digit across scripts,
// collapse to single spaces. Deliberately aggressive: outlets tweak dashes,
// quotes, and trailing bylines; the words themselves are the fingerprint.
export function normalizeSummary(summary: string): string {
  return summary
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

const MIN_NORMALIZED_CHARS = 40

// Null for absent/short summaries: tiny normalized strings (one shared
// sentence fragment, an outlet slogan) would false-match across unrelated
// articles.
export function bodyHash(summary: string | null | undefined): string | null {
  if (!summary) return null
  const normalized = normalizeSummary(summary)
  if (normalized.length < MIN_NORMALIZED_CHARS) return null
  return createHash('sha256').update(normalized).digest('hex')
}
