/** Editorial assessments require cited review; fetch health and model scores cannot determine them. */
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
  rationale: string
  reviewedAt: string
  disabledReason: string | null
  samples: ArticleSample[]
  sampleLimitations: string | null
}
export type SourceAudit = { version: 1; publishers: PublisherProfile[]; sources: SourceReview[] }

export function validateSourceAudit(audit: SourceAudit): string[] {
  const errors: string[] = []
  const publishers = new Set(audit.publishers.map(p => p.id))
  if (publishers.size !== audit.publishers.length) errors.push('Duplicate publisher IDs')
  if (new Set(audit.sources.map(s => s.sourceId)).size !== audit.sources.length) errors.push('Duplicate source IDs')
  const date = (value: string) => Number.isFinite(Date.parse(value))
  const url = (value: string) => { try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false } }
  for (const p of audit.publishers) {
    if (!date(p.reviewedAt) || !p.name || !p.ownership || !p.funding || !p.purpose || !p.sourcing || !p.corrections || !p.coverage) errors.push(`Incomplete publisher: ${p.id}`)
    if (!p.evidence.length || p.evidence.some(e => !url(e.url) || !e.title || !date(e.accessedAt))) errors.push(`Missing evidence: ${p.id}`)
  }
  for (const s of audit.sources) {
    if (!publishers.has(s.publisherId) || !date(s.reviewedAt) || !s.rationale || !url(s.feedUrl)) errors.push(`Incomplete source: ${s.sourceId}`)
    if (!['retain','retain with limitations','exclude','unresolved'].includes(s.decision)) errors.push(`Invalid decision: ${s.sourceId}`)
    if (s.samples.filter(a => a.access !== 'unavailable').length < 5 && !s.sampleLimitations) errors.push(`Missing sample limitation: ${s.sourceId}`)
    if (new Set(s.samples.map(a => a.url)).size !== s.samples.length) errors.push(`Duplicate sample: ${s.sourceId}`)
    if (s.samples.some(a => !url(a.url) || !a.title || !a.observation || !date(a.reviewedAt)
      || (a.publishedAt !== null && !date(a.publishedAt))
      || !['full text','publisher excerpt','unavailable'].includes(a.access))) errors.push(`Invalid sample: ${s.sourceId}`)
  }
  return errors
}
