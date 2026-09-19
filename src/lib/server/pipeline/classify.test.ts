import { describe, it, expect, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({
  upserts: [] as Array<Array<Record<string, unknown>>>,
  rejects: [] as Array<Array<{ guid: string; reason: string }>>,
  verdicts: [] as Array<Record<string, unknown>>,
  earlyClusters: 0,
}))

vi.mock('./persist', () => ({
  upsertArticles: (rows: Array<Record<string, unknown>>) => { io.upserts.push(rows); return Promise.resolve(rows.length) },
  writeRejects: (rows: Array<{ guid: string; reason: string }>) => { io.rejects.push(rows); return Promise.resolve() },
  writeVerdicts: (rows: Array<Record<string, unknown>>) => { io.verdicts.push(...rows); return Promise.resolve(rows.length) },
}))
vi.mock('./clustering', () => ({ embedAndAssignClusters: () => { io.earlyClusters++; return Promise.resolve() } }))
vi.mock('./signals', () => ({ enrichSignals: () => Promise.resolve() }))
// Importing the real judges would load the embedding model + env; the chain is
// what is under test, so tiers are supplied by the tests.
vi.mock('../judges', () => ({ headTier: () => null, jevTier: () => null }))

import { classifyFresh } from './classify'
import type { RelevanceTier, TierResult, Decision } from '../judges'
import type { ArticleInsert } from '../rss'
import type { RunStats } from './stats'

const art = (guid: string, published_at = '2026-09-19T10:00:00Z') =>
  ({ guid, title: guid, url: `https://x/${guid}`, summary: null, published_at, source_lang: 'en', source_id: null }) as unknown as ArticleInsert

function tier(
  name: 'head' | 'jev',
  decide: (guid: string) => Decision | 'pass',
  extra: Partial<TierResult<ArticleInsert>> & { cap?: number; auditGuids?: Record<string, Decision> } = {},
): RelevanceTier<ArticleInsert> {
  return {
    name, model: `${name}-test`, threshold: () => 0.5, cap: extra.cap ?? 1000,
    stamp: name === 'jev' ? (j) => ({ jev_relevant: j.p ?? 0 }) : undefined,
    judge: async (items) => {
      const audit = new Map<ArticleInsert, Decision>()
      const pick = (d: Decision | 'pass') => items.filter((a) => !(a.guid in (extra.auditGuids ?? {})) && decide(a.guid) === d)
      for (const a of items) if (extra.auditGuids?.[a.guid]) audit.set(a, extra.auditGuids[a.guid])
      return {
        accept: pick('accept').map((item) => ({ item, p: 0.9 })),
        reject: pick('reject').map((item) => ({ item, p: 0.1 })),
        pass: [...pick('pass'), ...audit.keys()],
        audit, failed: extra.failed ?? 0, stats: { pool: items.length }, summary: 'ok',
      }
    },
  }
}

beforeEach(() => { io.upserts = []; io.rejects = []; io.verdicts = []; io.earlyClusters = 0 })

describe('classifyFresh', () => {
  it('hands each tier only what the tier before passed on, and defers what the last one passes', async () => {
    const stats: RunStats = {}
    const seenByJev: string[] = []
    const jev = tier('jev', (g) => (g === 'j-yes' ? 'accept' : g === 'j-no' ? 'reject' : 'pass'))
    const judge = jev.judge
    jev.judge = (items, ctx) => { seenByJev.push(...items.map((a) => a.guid)); return judge(items, ctx) }
    await classifyFresh(
      ['h-yes', 'h-no', 'j-yes', 'j-no', 'nobody'].map((g) => art(g)),
      stats, Date.now(),
      [tier('head', (g) => (g === 'h-yes' ? 'accept' : g === 'h-no' ? 'reject' : 'pass')), jev],
    )
    expect(seenByJev.sort()).toEqual(['j-no', 'j-yes', 'nobody'])
    expect(stats.relevant).toBe(2)
    expect(stats.rejected).toBe(2)
    expect(stats.deferred).toBe(1)
    expect(stats.inserted).toBe(2)
  })

  it('records who said no, and stamps accepted rows only where the tier asks', async () => {
    await classifyFresh(
      ['h-no', 'j-yes', 'j-no'].map((g) => art(g)), {}, Date.now(),
      [tier('head', (g) => (g === 'h-no' ? 'reject' : 'pass')), tier('jev', (g) => (g === 'j-yes' ? 'accept' : 'reject'))],
    )
    expect(io.rejects.flat().map((r) => `${r.guid}:${r.reason}`).sort()).toEqual(['h-no:head', 'j-no:jev'])
    expect(io.upserts.flat()[0]).toMatchObject({ guid: 'j-yes', jev_relevant: 0.9 })
    expect(io.verdicts.map((v) => `${v.guid}:${v.judge}:${v.decision}`).sort()).toEqual(['h-no:head:reject', 'j-no:jev:reject', 'j-yes:jev:accept'])
  })

  it('lands an earlier tier’s accepts before the next tier’s network calls, but not the last tier’s', async () => {
    await classifyFresh([art('h-yes'), art('j-yes')], {}, Date.now(), [tier('head', (g) => (g === 'h-yes' ? 'accept' : 'pass')), tier('jev', () => 'accept')])
    expect(io.earlyClusters).toBe(1)
  })

  it('passes a tier’s overflow on untouched', async () => {
    const stats: RunStats = {}
    await classifyFresh(
      [art('new', '2026-09-19T12:00:00Z'), art('old', '2026-09-19T01:00:00Z')], stats, Date.now(),
      [tier('head', () => 'reject', { cap: 1 }), tier('jev', () => 'accept')],
    )
    expect(io.rejects.flat().map((r) => r.guid)).toEqual(['new']) // newest first → the cap takes 'new'
    expect(io.upserts.flat().map((r) => r.guid)).toEqual(['old'])
  })

  it('scores a tier’s audit slice against what the later tiers decided', async () => {
    const stats: RunStats = {}
    await classifyFresh(
      [art('agree'), art('disagree'), art('unsettled')], stats, Date.now(),
      [
        tier('head', () => 'pass', { auditGuids: { agree: 'accept', disagree: 'accept', unsettled: 'reject' } }),
        tier('jev', (g) => (g === 'agree' ? 'accept' : g === 'disagree' ? 'reject' : 'pass')),
      ],
    )
    expect(stats.cls_head?.audit_agreement).toEqual({ accept: { n: 2, agree: 1 }, reject: { n: 0, agree: 0 } })
  })

  it('reports the jev tier’s pool and failures for the outage guard', async () => {
    const out = await classifyFresh([art('a'), art('b')], {}, Date.now(), [tier('jev', () => 'pass', { failed: 2 })])
    expect(out).toEqual({ jevPool: 2, jevFailed: 2 })
  })
})
