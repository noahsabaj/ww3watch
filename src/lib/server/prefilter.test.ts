import { describe, it, expect } from 'vitest'
import { EMBEDDING_DIM, EMBEDDING_MODEL_TAG } from './embeddings'
import {
  validateHead, headScore, tierOf, partitionByHead, auditAgreement, type ClassifierHead,
} from './prefilter'

function head(over: Partial<ClassifierHead> = {}): ClassifierHead {
  const weights = new Array(EMBEDDING_DIM).fill(0)
  weights[0] = 8 // score is driven by the first component alone
  return {
    model_tag: EMBEDDING_MODEL_TAG,
    trained_at: '2026-09-14T00:00:00Z',
    n_pos: 1000,
    n_neg: 1000,
    weights,
    bias: 0,
    reject_below: 0.2,
    accept_above: 0.8,
    ...over,
  }
}
const vec = (x: number) => {
  const v = new Array(EMBEDDING_DIM).fill(0)
  v[0] = x
  return v
}

describe('validateHead', () => {
  it('accepts a well-formed head', () => {
    expect(validateHead(head())).toEqual([])
  })
  it('rejects a foreign embedding vintage, wrong dims, and an inverted band', () => {
    expect(validateHead(head({ model_tag: 'other' }))[0]).toMatch(/model_tag/)
    expect(validateHead(head({ weights: [1, 2, 3] }))[0]).toMatch(/weights length/)
    expect(validateHead(head({ reject_below: 0.9 }))[0]).toMatch(/no uncertain band/)
  })
})

describe('headScore / tierOf', () => {
  it('is a sigmoid over the dot product', () => {
    const h = head()
    expect(headScore(h, vec(0))).toBeCloseTo(0.5)
    expect(headScore(h, vec(1))).toBeGreaterThan(0.99)
    expect(headScore(h, vec(-1))).toBeLessThan(0.01)
  })
  it('tiers on the two thresholds', () => {
    const h = head()
    expect(tierOf(h, 0.1)).toBe('reject')
    expect(tierOf(h, 0.5)).toBe('uncertain')
    expect(tierOf(h, 0.95)).toBe('accept')
    expect(tierOf(h, 0.2)).toBe('uncertain') // boundaries are inclusive to the band
    expect(tierOf(h, 0.8)).toBe('uncertain')
  })
})

describe('partitionByHead', () => {
  const items = ['a', 'b', 'c', 'd', 'e']
  const scores = [0.99, 0.01, 0.5, 0.97, 0.02]

  it('routes confident tiers away from the LLM and keeps the band', () => {
    const p = partitionByHead(items, scores, head(), { auditRate: 0, random: () => 1 })
    expect(p.accept).toEqual(['a', 'd'])
    expect(p.reject).toEqual(['b', 'e'])
    expect(p.uncertain).toEqual(['c'])
    expect(p.audit.size).toBe(0)
    expect(p.scores.get('a')).toBe(0.99)
  })

  it('moves an audit slice of the confident tiers into the LLM set, remembering the tier', () => {
    // random() < auditRate picks the item: pick a and b (first two confident draws).
    const draws = [0.0, 0.0, 0.9, 0.9]
    let i = 0
    const p = partitionByHead(items, scores, head(), { auditRate: 0.1, random: () => draws[i++] })
    expect(p.audit.get('a')).toBe('accept')
    expect(p.audit.get('b')).toBe('reject')
    expect(p.uncertain).toEqual(['a', 'b', 'c'])
    expect(p.accept).toEqual(['d'])
    expect(p.reject).toEqual(['e'])
  })
})

describe('auditAgreement', () => {
  it('scores agreement per tier and skips items the LLM never judged', () => {
    const audit = new Map<string, 'accept' | 'reject' | 'uncertain'>([
      ['a', 'accept'], ['b', 'accept'], ['c', 'reject'], ['d', 'reject'], ['e', 'reject'],
    ])
    const stats = auditAgreement(audit, (x) => x, new Set(['a', 'c']), new Set(['b', 'd']))
    // a: head accept, LLM accept ✓ · b: head accept, LLM reject ✗
    // c: head reject, LLM accept ✗ · d: head reject, LLM reject ✓ · e: no verdict → skipped
    expect(stats).toEqual({ accept: { n: 2, agree: 1 }, reject: { n: 2, agree: 1 } })
  })
})
