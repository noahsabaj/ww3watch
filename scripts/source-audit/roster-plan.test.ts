import { describe, expect, it } from 'vitest'
import { matches, reversePlan, validatePlan, type RosterPlan } from './roster-plan'
import type { SourceAudit } from '../../src/lib/source-audit'

const now = Date.parse('2026-09-20T18:00:00Z')
const row = { name: 'Example', url: 'https://example.org/feed', region: 'African', lang: 'en', affiliation: null, enabled: false }
const plan: RosterPlan = { version: 1, id: 'reviewed-repair', reviewedAt: new Date(now).toISOString(), changes: [{ sourceId: 'a', before: row, after: { ...row, enabled: true }, reason: 'Publisher endpoint repaired', evidence: ['https://example.org/about'] }] }
const audit = { sources: [{ sourceId: 'a', decision: 'retain' }] } as SourceAudit
const probe = (minutes: number) => ({ sourceId: 'a', url: row.url, error: null, itemCount: 5, checkedAt: new Date(now - minutes * 60000).toISOString() })

describe('reviewed roster changes', () => {
  it('rejects one probe, duplicate timestamps, failures, old results and URL mismatches', () => {
    for (const probes of [[probe(1)], [probe(1),probe(1)], [probe(1),probe(15)], [probe(1),{ ...probe(20), error: '403' }], [probe(1),probe(12000)], [probe(1),{ ...probe(20), url: 'https://example.org/old' }]]) {
      expect(validatePlan(plan,audit,probes,now)).toContain('Two successful probes 15 minutes apart required: a')
    }
    expect(validatePlan(plan,audit,[probe(1),probe(16)],now)).toEqual([])
  })
  it('cannot enable unresolved or excluded sources or modify non-curation fields', () => {
    expect(validatePlan(plan,{ sources: [] } as unknown as SourceAudit,[probe(1),probe(16)],now).join()).toContain('Review unresolved')
    expect(validatePlan(plan,{ sources: [{ sourceId: 'a', decision: 'exclude' }] } as SourceAudit,[probe(1),probe(16)],now).join()).toContain('Excluded')
    const bad = structuredClone(plan)
    Object.assign(bad.changes[0].after, { last_ok_at: 'fake success' })
    expect(validatePlan(bad,audit,[probe(1),probe(16)],now).join()).toContain('Invalid curated fields')
  })
  it('restores before-values while refusing a changed curation snapshot', () => {
    const reverse = reversePlan(plan).changes[0]
    expect(reverse.after).toEqual(row)
    expect(matches({ ...plan.changes[0].after, name: 'Edited concurrently' },reverse.before)).toBe(false)
    expect(matches({ ...plan.changes[0].after, ...{ consecutive_failures: 2 } },reverse.before)).toBe(true)
  })
})
