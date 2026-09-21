// Editorial assessments require cited review. Fetch health and model scores
// cannot determine them, and no assessment here is inferred from uptime.
//
// PROVENANCE: the article samples and the cited pages were fetched; the prose
// summarising them was drafted by a model from those fetches and is labelled as
// such on /about. It is not a human editor's review, and the page must not
// imply one. `accessedAt` records the date of the review pass, not a per-URL
// fetch receipt — see docs/CONVENTIONS.md.
export type AuditDecision = 'retain' | 'retain with limitations' | 'exclude' | 'unresolved'
export type Evidence = { url: string; title: string; accessedAt: string }
export type ArticleSample = {
  url: string
  title: string
  publishedAt: string | null
  reviewedAt: string
  observation: string
  access: 'full text' | 'publisher excerpt' | 'unavailable'
}
export type PublisherProfile = {
  id: string
  name: string
  ownership: string
  funding: string
  purpose: string
  sourcing: string
  corrections: string
  coverage: string
  limitations: string[]
  evidence: Evidence[]
  reviewedAt: string
}
export type SourceReview = {
  sourceId: string
  publisherId: string
  name: string
  feedUrl: string
  decision: AuditDecision
  /** Feed-specific reasoning, or null when the publisher's `sourcing` says it all. */
  rationale: string | null
  reviewedAt: string
  disabledReason: string | null
  /** Samples live in data/source-samples.ts and load on demand; this is their count. */
  sampleCount: number
  sampleLimitations: string | null
}
export type SourceAudit = { version: 1; publishers: PublisherProfile[]; sources: SourceReview[] }

export function validateSourceAudit(audit: SourceAudit): string[] {
  const errors: string[] = []
  const publishers = new Set(audit.publishers.map(p => p.id))
  const publisherById = new Map(audit.publishers.map(p => [p.id, p]))
  if (publishers.size !== audit.publishers.length) errors.push('Duplicate publisher IDs')
  if (new Set(audit.sources.map(s => s.sourceId)).size !== audit.sources.length) errors.push('Duplicate source IDs')
  const date = (value: string) => Number.isFinite(Date.parse(value))
  const url = (value: string) => { try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false } }
  for (const p of audit.publishers) {
    if (!date(p.reviewedAt) || !p.name || !p.ownership || !p.funding || !p.purpose || !p.sourcing || !p.corrections || !p.coverage) errors.push(`Incomplete publisher: ${p.id}`)
    if (!p.evidence.length || p.evidence.some(e => !url(e.url) || !e.title || !date(e.accessedAt))) errors.push(`Missing evidence: ${p.id}`)
  }
  for (const s of audit.sources) {
    if (!publishers.has(s.publisherId) || !date(s.reviewedAt) || !url(s.feedUrl)) errors.push(`Incomplete source: ${s.sourceId}`)
    if (s.rationale !== null && !s.rationale.trim()) errors.push(`Empty rationale: ${s.sourceId}`)
    // A rationale that just repeats the publisher paragraph is not a per-feed
    // judgement; it read as one on 137 of 142 profiles before this check.
    if (s.rationale !== null && s.rationale === publisherById.get(s.publisherId)?.sourcing) errors.push(`Rationale duplicates publisher sourcing: ${s.sourceId}`)
    if (!['retain','retain with limitations','exclude','unresolved'].includes(s.decision)) errors.push(`Invalid decision: ${s.sourceId}`)
    if (!Number.isInteger(s.sampleCount) || s.sampleCount < 0) errors.push(`Invalid sampleCount: ${s.sourceId}`)
  }
  return errors
}

/** Samples ship separately, so they need their own check — the shape rules that
 *  used to live in validateSourceAudit, plus the cross-file agreement that the
 *  split could otherwise let drift. */
export function validateSourceSamples(audit: SourceAudit, samples: Record<string, ArticleSample[]>): string[] {
  const errors: string[] = []
  const date = (value: string) => Number.isFinite(Date.parse(value))
  const url = (value: string) => { try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false } }
  for (const key of Object.keys(samples)) {
    if (!audit.sources.some(s => s.sourceId === key)) errors.push(`Samples for unknown source: ${key}`)
  }
  for (const s of audit.sources) {
    const set = samples[s.sourceId]
    if (!set) { errors.push(`Missing samples: ${s.sourceId}`); continue }
    if (set.length !== s.sampleCount) errors.push(`sampleCount disagrees with samples: ${s.sourceId}`)
    if (set.filter(a => a.access !== 'unavailable').length < 5 && !s.sampleLimitations) errors.push(`Missing sample limitation: ${s.sourceId}`)
    if (new Set(set.map(a => a.url)).size !== set.length) errors.push(`Duplicate sample: ${s.sourceId}`)
    // Feed XML arrives pretty-printed; an untrimmed URL would slip past the line above.
    if (set.some(a => a.url !== a.url.trim())) errors.push(`Untrimmed sample URL: ${s.sourceId}`)
    if (set.some(a => !url(a.url) || !a.title || !a.observation || !date(a.reviewedAt)
      || (a.publishedAt !== null && !date(a.publishedAt))
      || !['full text','publisher excerpt','unavailable'].includes(a.access))) errors.push(`Invalid sample: ${s.sourceId}`)
  }
  return errors
}
