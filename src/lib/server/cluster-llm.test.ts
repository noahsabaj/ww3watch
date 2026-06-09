import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the LLM wrapper so we control its output (and avoid loading env/network).
vi.mock('./llm', () => ({ callLLM: vi.fn() }))
import { callLLM } from './llm'
import { assignClusters } from './cluster-llm'

const mockedCallLLM = vi.mocked(callLLM)

beforeEach(() => mockedCallLLM.mockReset())

describe('assignClusters', () => {
  it('returns an empty map when there are no new articles', async () => {
    const result = await assignClusters([], [])
    expect(result.size).toBe(0)
  })

  it('resolves NEW_x labels to the first article that received them', async () => {
    mockedCallLLM.mockResolvedValue('["NEW_0","NEW_1","NEW_1"]')
    const result = await assignClusters(
      [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
      [],
    )
    expect(result.get('a')).toBe('a') // NEW_0 → first occurrence
    expect(result.get('b')).toBe('b') // NEW_1 → first occurrence
    expect(result.get('c')).toBe('b') // NEW_1 again → same representative
  })

  it('assigns an article to an existing cluster uuid', async () => {
    mockedCallLLM.mockResolvedValue('["existing-1"]')
    const result = await assignClusters(
      [{ id: 'a', title: 'A' }],
      [{ id: 'existing-1', title: 'X' }],
    )
    expect(result.get('a')).toBe('existing-1')
  })

  it('falls back to an empty map on malformed JSON', async () => {
    mockedCallLLM.mockResolvedValue('not json at all')
    const result = await assignClusters([{ id: 'a', title: 'A' }], [])
    expect(result.size).toBe(0)
  })

  it('falls back to an empty map on a wrong-length array', async () => {
    mockedCallLLM.mockResolvedValue('["NEW_0","NEW_1"]') // 2 labels for 1 article
    const result = await assignClusters([{ id: 'a', title: 'A' }], [])
    expect(result.size).toBe(0)
  })
  // Note: the "callLLM rejects/throws" path reaches the same catch → fallback as
  // the malformed-JSON case above; not duplicated here because vitest 4 surfaces
  // an error thrown from a mock even when downstream code catches it.
})
