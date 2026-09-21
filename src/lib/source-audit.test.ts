import { expect, it } from 'vitest'
import { validateSourceAudit, validateSourceSamples, type SourceAudit, type ArticleSample } from './source-audit'
import { sourceAudit } from './data/source-audit'
import { readFileSync } from 'node:fs'

// Ships as a static asset (not a module) so it stays out of the bundle and the
// PWA precache; that means only this test stands between it and silent drift.
const sourceSamples = JSON.parse(readFileSync('static/source-samples.json', 'utf8')) as Record<string, ArticleSample[]>
import { sourceCatalog } from './data/source-catalog'

it('maps published reviews to stable catalog IDs without treating pending feeds as reviewed', () => {
  expect(validateSourceAudit(sourceAudit)).toEqual([])
  expect(new Set(sourceCatalog.map(s => s.id)).size).toBe(sourceCatalog.length)
  for (const s of sourceAudit.sources) {
    expect(sourceCatalog.find(c => c.id === s.sourceId)?.name).toBe(s.name)
  }
})

// The samples ship as their own lazily-loaded module, so nothing but this check
// stops the two files drifting apart.
it('keeps the split sample file in agreement with the reviews it belongs to', () => {
  expect(validateSourceSamples(sourceAudit, sourceSamples)).toEqual([])
})

it('rejects unsupported publication claims and unaccounted-for samples', () => {
  const audit: SourceAudit = {
    version: 1, publishers: [], sources: [{
      sourceId: 'test', publisherId: 'missing', name: 'Test', feedUrl: 'https://example.com/rss',
      decision: 'unresolved', rationale: 'Ownership not verified', reviewedAt: '2026-09-20',
      disabledReason: null, sampleCount: 0, sampleLimitations: null,
    }],
  }
  expect(validateSourceAudit(audit)).toContain('Incomplete source: test')
  expect(validateSourceSamples(audit, { test: [] })).toContain('Missing sample limitation: test')
})

it('rejects duplicate articles and invalid publication dates or access claims', () => {
  const audit: SourceAudit = structuredClone(sourceAudit)
  const samples = structuredClone(sourceSamples)
  const source = audit.sources[0]
  const set = samples[source.sourceId]
  set.push({ ...set[0], publishedAt: 'not-a-date', access: 'assumed' as never })
  expect(validateSourceSamples(audit, samples)).toContain(`Duplicate sample: ${source.sourceId}`)
  expect(validateSourceSamples(audit, samples)).toContain(`Invalid sample: ${source.sourceId}`)
  expect(validateSourceSamples(audit, samples)).toContain(`sampleCount disagrees with samples: ${source.sourceId}`)
})

// The padding this branch removed: a rationale that only repeats the publisher's
// own sourcing paragraph rendered as if it were a per-feed judgement.
it('rejects a rationale that just repeats the publisher paragraph', () => {
  const audit: SourceAudit = structuredClone(sourceAudit)
  audit.sources[0].rationale = audit.publishers.find(p => p.id === audit.sources[0].publisherId)!.sourcing
  expect(validateSourceAudit(audit)).toContain(`Rationale duplicates publisher sourcing: ${audit.sources[0].sourceId}`)
})

it('rejects a sample URL carrying raw feed whitespace', () => {
  const audit: SourceAudit = structuredClone(sourceAudit)
  const samples = structuredClone(sourceSamples)
  const id = audit.sources[0].sourceId
  samples[id][0] = { ...samples[id][0], url: `\n  ${samples[id][0].url}` }
  expect(validateSourceSamples(audit, samples)).toContain(`Untrimmed sample URL: ${id}`)
})
