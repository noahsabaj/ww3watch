import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the LLM wrapper so we control its output (and avoid loading env/network).
vi.mock('./llm', () => ({ callLLM: vi.fn() }))
import { callLLM } from './llm'
import { assignClusters } from './cluster-llm'

const mockedCallLLM = vi.mocked(callLLM)

beforeEach(() => mockedCallLLM.mockReset())

describe('assignClusters (E#/N# label protocol)', () => {
  it('returns an empty map when there are no new articles', async () => {
    const result = await assignClusters([], [])
    expect(result.size).toBe(0)
  })

  it('maps E labels to the existing cluster uuid by index', async () => {
    mockedCallLLM.mockResolvedValue('["E1","E0"]')
    const result = await assignClusters(
      [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      [{ id: 'cluster-zero', title: 'X' }, { id: 'cluster-one', title: 'Y' }],
    )
    expect(result.get('a')).toBe('cluster-one')
    expect(result.get('b')).toBe('cluster-zero')
  })

  it('shares N labels: first article becomes the representative', async () => {
    mockedCallLLM.mockResolvedValue('["N0","N1","N1"]')
    const result = await assignClusters(
      [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
      [],
    )
    expect(result.get('a')).toBe('a')
    expect(result.get('b')).toBe('b')
    expect(result.get('c')).toBe('b') // same N1 → b's id
  })

  it('works with zero existing clusters (first-run case)', async () => {
    mockedCallLLM.mockResolvedValue('["N0","N0"]')
    const result = await assignClusters(
      [{ id: 'a', title: 'Same story' }, { id: 'b', title: 'Same story too' }],
      [],
    )
    expect(result.get('a')).toBe('a')
    expect(result.get('b')).toBe('a')
    // The prompt must instruct N-only labels when no clusters exist.
    const prompt = mockedCallLLM.mock.calls[0][0][1].content
    expect(prompt).toContain('(none)')
  })

  it('rejects an out-of-range E index (empty-map fallback)', async () => {
    mockedCallLLM.mockResolvedValue('["E5"]') // only 1 existing cluster
    const result = await assignClusters(
      [{ id: 'a', title: 'A' }],
      [{ id: 'cluster-zero', title: 'X' }],
    )
    expect(result.size).toBe(0)
  })

  it('rejects labels that are not E#/N# — e.g. hallucinated uuids (fallback)', async () => {
    mockedCallLLM.mockResolvedValue('["abc-def-123"]')
    const result = await assignClusters([{ id: 'a', title: 'A' }], [])
    expect(result.size).toBe(0)
  })

  it('falls back to an empty map on malformed JSON', async () => {
    mockedCallLLM.mockResolvedValue('not json at all')
    const result = await assignClusters([{ id: 'a', title: 'A' }], [])
    expect(result.size).toBe(0)
  })

  it('falls back to an empty map on a wrong-length array', async () => {
    mockedCallLLM.mockResolvedValue('["N0","N1"]') // 2 labels for 1 article
    const result = await assignClusters([{ id: 'a', title: 'A' }], [])
    expect(result.size).toBe(0)
  })
})
