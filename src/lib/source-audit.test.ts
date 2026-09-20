import { expect, it } from 'vitest'
import { validateSourceAudit, type SourceAudit } from './source-audit'
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
