import { describe, expect, it, vi } from 'vitest'
import { executeRoster, type JournalEntry, type RosterStore, type Snapshot } from './execute-roster'
import { reversePlan, type RosterPlan } from './roster-plan'

const before = { name: 'Publisher', url: 'https://example.org/old', region: 'African', lang: 'en', enabled: false, affiliation: null }
const after = { ...before, url: 'https://example.org/rss', enabled: true }
const plan: RosterPlan = { version: 1, id: 'repair', reviewedAt: '2026-09-20', changes: ['a', 'b'].map(sourceId => ({ sourceId, before, after, reason: 'Verified publisher feed', evidence: ['https://example.org'] })) }

function fixture() {
  const rows = new Map<string, Snapshot>(['a', 'b'].map(id => [id, { ...before, updated_at: 'first' }]))
  let saved: JournalEntry[] = []
  const save = (entries: JournalEntry[]) => { saved = structuredClone(entries) }
  const store: RosterStore = {
    read: vi.fn(async id => structuredClone(rows.get(id)!)),
    compareAndSet: vi.fn(async (id, version, value) => {
      expect(saved.find(e => e.sourceId === id)?.state).toBe('prepared')
      if (rows.get(id)!.updated_at !== version) return false
      rows.set(id, { ...value, updated_at: `next-${version}` })
      return true
    }),
  }
  return { rows, store, save, saved: () => saved }
}

describe('serialized curation execution', () => {
  it('dry-runs the whole plan without writes', async () => {
    const f = fixture()
    await executeRoster(plan, true, f.store, f.save)
    expect(f.store.compareAndSet).not.toHaveBeenCalled()
    expect(f.saved().map(e => e.state)).toEqual(['prepared', 'prepared'])
  })

  it('preflights every row before changing any source', async () => {
    const f = fixture()
    f.rows.set('b', { ...before, name: 'New curation', updated_at: 'new' })
    await expect(executeRoster(plan, false, f.store, f.save)).rejects.toThrow('rebase the plan: b')
    expect(f.store.compareAndSet).not.toHaveBeenCalled()
  })

  it('refuses curation changed after preflight and leaves recoverable before-values', async () => {
    const f = fixture()
    const original = f.store.compareAndSet
    f.store.compareAndSet = async (...args) => {
      f.rows.set(args[0], { ...before, name: 'Concurrent edit', updated_at: 'concurrent' })
      return original(...args)
    }
    await expect(executeRoster(plan, false, f.store, f.save)).rejects.toThrow('snapshot changed: a')
    expect(f.rows.get('a')!.name).toBe('Concurrent edit')
    expect(f.saved()).toMatchObject([{ sourceId: 'a', before, state: 'prepared' }])
  })

  it('retries a partially applied plan without rewriting the successful source', async () => {
    const f = fixture()
    const original = f.store.compareAndSet
    f.store.compareAndSet = vi.fn<RosterStore['compareAndSet']>(async (...args) => args[0] === 'b' ? false : original(...args))
    await expect(executeRoster(plan, false, f.store, f.save)).rejects.toThrow('snapshot changed: b')
    expect(f.saved().map(e => e.state)).toEqual(['applied', 'prepared'])
    vi.mocked(original).mockClear()
    f.store.compareAndSet = original
    await executeRoster(plan, false, f.store, f.save)
    expect(f.saved().map(e => e.state)).toEqual(['already-matches', 'applied'])
    expect(f.store.compareAndSet).toHaveBeenCalledTimes(1)
    expect(f.rows.get('b')).toMatchObject(after)
  })

  it('rolls back an ambiguous applied request and leaves unapplied rows alone', async () => {
    const f = fixture()
    const original = f.store.compareAndSet
    f.store.compareAndSet = async (...args) => {
      await original(...args)
      throw new Error('Connection lost after commit')
    }
    await expect(executeRoster(plan, false, f.store, f.save)).rejects.toThrow('Connection lost')
    expect(f.saved()[0]).toMatchObject({ before, after, state: 'prepared' })
    f.store.compareAndSet = vi.fn(original)
    await executeRoster(reversePlan(plan), false, f.store, f.save)
    expect(f.saved().map(e => e.state)).toEqual(['already-matches', 'applied'])
    for (const row of f.rows.values()) expect(row).toMatchObject(before)
  })

  it('resets replacement endpoint health without inventing a successful fetch', async () => {
    const f = fixture()
    await executeRoster(plan, false, f.store, f.save)
    expect(f.store.compareAndSet).toHaveBeenCalledWith('a', 'first', after, {
      consecutive_failures: 0, last_ok_at: null, last_error: null, last_error_kind: null, last_via: null,
    })
  })
})
