import { describe, it, expect } from 'vitest'
import { selectStaleWriteOffs, staleRejectRow } from './backlog'

const HOUR = 3_600_000
const now = Date.parse('2026-07-29T18:00:00Z')
const cutoff = now - 48 * HOUR

const at = (iso: string) => ({ guid: `g-${iso}`, title: 't', published_at: iso })

describe('selectStaleWriteOffs', () => {
  it('writes off what is older than the cutoff and keeps what is not', () => {
    const picked = selectStaleWriteOffs(
      [
        at('2026-07-20T00:00:00Z'), // 9 days — stale
        at('2026-07-26T00:00:00Z'), // 66h — stale
        at('2026-07-28T00:00:00Z'), // 42h — keep
        at('2026-07-29T17:00:00Z'), // 1h — keep
      ],
      cutoff,
    )
    expect(picked.map((a) => a.published_at)).toEqual([
      '2026-07-20T00:00:00Z',
      '2026-07-26T00:00:00Z',
    ])
  })

  it('keeps items with NO published_at rather than treating them as ancient', () => {
    // The one that matters. rss.ts clamps out-of-range pubDates to null, so a
    // feed with a broken timezone or year emits null for EVERY item it
    // publishes — and null sorts last under the newest-first ordering, which
    // drops that whole source into this band. Reading a missing date as epoch 0
    // (the natural `?? 0` spelling, and what the neighbouring sort's `?? ''`
    // invites) would silently write off every article that source ever emits,
    // permanently, with no signal anywhere. Unknown age is not old age.
    const picked = selectStaleWriteOffs(
      [
        { guid: 'null-date', title: 'Strike on port', published_at: null },
        { guid: 'absent-date', title: 'Border clash' },
      ],
      cutoff,
    )
    expect(picked).toEqual([])
  })

  it('keeps items whose published_at does not parse', () => {
    const picked = selectStaleWriteOffs(
      [{ guid: 'junk', title: 'x', published_at: 'not a date at all' }],
      cutoff,
    )
    expect(picked).toEqual([])
  })

  it('keeps an item exactly at the cutoff (strictly older is stale)', () => {
    const picked = selectStaleWriteOffs(
      [{ guid: 'edge', title: 'x', published_at: new Date(cutoff).toISOString() }],
      cutoff,
    )
    expect(picked).toEqual([])
  })

  it('never writes off a future-dated item', () => {
    const picked = selectStaleWriteOffs(
      [{ guid: 'future', title: 'x', published_at: '2027-01-01T00:00:00Z' }],
      cutoff,
    )
    expect(picked).toEqual([])
  })
})

describe('staleRejectRow', () => {
  it('carries reason=stale so calibration can exclude it', () => {
    // calibrate-classify.ts loads reason='llm' as its NEGATIVES class. A stale
    // row leaking in would tune the pre-filter floor against an age filter's
    // output instead of a model verdict.
    const row = staleRejectRow({
      guid: 'g1',
      title: 'Border clash',
      published_at: '2026-07-20T00:00:00Z',
      source_id: 's1',
      source_lang: 'ru',
    })
    expect(row).toEqual({
      guid: 'g1',
      title: 'Border clash',
      source_id: 's1',
      lang: 'ru',
      reason: 'stale',
    })
  })

  it('nulls missing attribution rather than emitting undefined', () => {
    // PostgREST needs uniform keys across an upsert batch; undefined would drop
    // the key for that row and 400 the whole batch.
    const row = staleRejectRow({ guid: 'g2' })
    expect(row).toEqual({ guid: 'g2', title: null, source_id: null, lang: null, reason: 'stale' })
    expect(Object.values(row).every((v) => v !== undefined)).toBe(true)
  })
})
