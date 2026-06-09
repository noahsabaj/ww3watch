import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the LLM wrapper so we control its output (and avoid loading env/network).
vi.mock('./llm', () => ({ callLLM: vi.fn() }))
import { callLLM } from './llm'
import { assignClusters } from './cluster-llm'

const mockedCallLLM = vi.mocked(callLLM)

beforeEach(() => mockedCallLLM.mockReset())

describe('assignClusters (index→label object protocol)', () => {
  it('returns an empty map when there are no new articles', async () => {
    const result = await assignClusters([], [])
    expect(result.size).toBe(0)
  })

  it('maps E labels to the existing cluster uuid by index', async () => {
    mockedCallLLM.mockResolvedValue('{"0":"E1","1":"E0"}')
    const result = await assignClusters(
      [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      [{ id: 'cluster-zero', title: 'X' }, { id: 'cluster-one', title: 'Y' }],
    )
    expect(result.get('a')).toBe('cluster-one')
    expect(result.get('b')).toBe('cluster-zero')
  })

  it('shares N labels: lowest-index article becomes the representative', async () => {
    // Keys deliberately out of order — representative must still be article a (index 0).
    mockedCallLLM.mockResolvedValue('{"2":"N1","1":"N1","0":"N0"}')
    const result = await assignClusters(
      [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
      [],
    )
    expect(result.get('a')).toBe('a')
    expect(result.get('b')).toBe('b')
    expect(result.get('c')).toBe('b') // same N1 as b → b's id
  })

  it('tolerates a miscount: assigns present keys, skips missing ones', async () => {
    // Model returned only 2 of 3 indices — the old array protocol failed the whole
    // batch here; now article c just stays unassigned.
    mockedCallLLM.mockResolvedValue('{"0":"N0","1":"N1"}')
    const result = await assignClusters(
      [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
      [],
    )
    expect(result.get('a')).toBe('a')
    expect(result.get('b')).toBe('b')
    expect(result.has('c')).toBe(false)
  })

  it('skips out-of-range E labels and garbage values, keeps the rest', async () => {
    mockedCallLLM.mockResolvedValue('{"0":"E9","1":"N0","2":"abc","3":"N0"}')
    const result = await assignClusters(
      [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }],
      [{ id: 'cluster-zero', title: 'X' }], // only E0 exists
    )
    expect(result.has('a')).toBe(false) // E9 out of range
    expect(result.has('c')).toBe(false) // 'abc' invalid
    expect(result.get('b')).toBe('b') // N0 rep
    expect(result.get('d')).toBe('b') // joins N0
  })

  it('works with zero existing clusters (first-run case) and states (none) in the prompt', async () => {
    mockedCallLLM.mockResolvedValue('{"0":"N0","1":"N0"}')
    const result = await assignClusters(
      [{ id: 'a', title: 'Same story' }, { id: 'b', title: 'Same story too' }],
      [],
    )
    expect(result.get('a')).toBe('a')
    expect(result.get('b')).toBe('a')
    const prompt = mockedCallLLM.mock.calls[0][0][1].content
    expect(prompt).toContain('(none)')
  })

  it('falls back to an empty map on malformed JSON', async () => {
    mockedCallLLM.mockResolvedValue('not json at all')
    const result = await assignClusters([{ id: 'a', title: 'A' }], [])
    expect(result.size).toBe(0)
  })

  it('falls back to an empty map when the response is an array, not an object', async () => {
    mockedCallLLM.mockResolvedValue('["N0"]')
    const result = await assignClusters([{ id: 'a', title: 'A' }], [])
    expect(result.size).toBe(0)
  })
})
