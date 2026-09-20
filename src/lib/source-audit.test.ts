import { expect, it } from 'vitest'
import { validateSourceAudit, type SourceAudit } from './source-audit'
import { sourceAudit } from './data/source-audit'
import { sourceCatalog } from './data/source-catalog'

it('maps published reviews to stable catalog IDs without treating pending feeds as reviewed', () => {
  expect(validateSourceAudit(sourceAudit)).toEqual([])
  expect(new Set(sourceCatalog.map(s => s.id)).size).toBe(sourceCatalog.length)
  for (const s of sourceAudit.sources) {
    expect(sourceCatalog.find(c => c.id === s.sourceId)?.name).toBe(s.name)
    expect(new Set(s.samples.map(a => a.url)).size).toBe(s.samples.length)
  }
})
it('rejects unsupported publication claims and unaccounted-for samples', () => {
  const audit: SourceAudit = {
    version: 1, publishers: [], sources: [{
      sourceId: 'test', publisherId: 'missing', name: 'Test', feedUrl: 'https://example.com/rss',
      decision: 'unresolved', rationale: 'Ownership not verified', reviewedAt: '2026-09-20',
      disabledReason: null, samples: [], sampleLimitations: null,
    }],
  }
  expect(validateSourceAudit(audit)).toContain('Incomplete source: test')
  expect(validateSourceAudit(audit)).toContain('Missing sample limitation: test')
})
