import { describe, it, expect } from 'vitest'
import { preprocessTitle, shouldEmbed, embedTitles, type Extractor } from './embeddings'

// Glue-only tests: the extractor is injected so vitest never downloads or
// instantiates the real model (CI runs on every PR).

describe('preprocessTitle', () => {
  // These input strings contain LITERAL invisible characters (RLM/LRM/LRE/PDF,
  // ZWSP, BOM) on purpose — that's exactly how they arrive in feed titles.
  it('strips bidi controls and zero-width marks', () => {
    expect(preprocessTitle('‏module‎ test ‪base‬'.replace('module', 'X'))).toBe('X test base')
    expect(preprocessTitle('a​b﻿c')).toBe('abc')
  })

  it('collapses whitespace and trims', () => {
    expect(preprocessTitle('  Iran   strikes\n back ')).toBe('Iran strikes back')
  })

  it('NFC-normalizes', () => {
    expect(preprocessTitle('Café')).toBe('Café')
  })

  it('does not lowercase (e5 is cased)', () => {
    expect(preprocessTitle('NATO Summit')).toBe('NATO Summit')
  })
})

describe('shouldEmbed', () => {
  it('rejects the rss.ts placeholder, empties, and near-empties', () => {
    expect(shouldEmbed('(no title)')).toBe(false)
    expect(shouldEmbed('')).toBe(false)
    expect(shouldEmbed('   ')).toBe(false)
    expect(shouldEmbed('Iran')).toBe(false) // < 15 chars — too generic to cluster on
  })

  it('accepts real headlines', () => {
    expect(shouldEmbed('Iran strikes back at US bases')).toBe(true)
    expect(shouldEmbed('حملات جنگنده‌های پاکستانی به مناطقی در جنوب و شرق افغانستان')).toBe(true)
  })
})

describe('embedTitles', () => {
  const seen: string[][] = []
  const fake: Extractor = async (texts) => {
    seen.push([...texts])
    return { tolist: () => texts.map(() => Array(384).fill(0)) }
  }

  it('prefixes every title with "query: " and preprocesses', async () => {
    seen.length = 0
    await embedTitles(['  Iran   strikes back at US bases '], fake)
    expect(seen[0]).toEqual(['query: Iran strikes back at US bases'])
  })

  it('batches at 32 and preserves order across batches', async () => {
    seen.length = 0
    const titles = Array.from({ length: 70 }, (_, i) => `headline number ${i} about events`)
    const out = await embedTitles(titles, fake)
    expect(seen.map(b => b.length)).toEqual([32, 32, 6])
    expect(out).toHaveLength(70)
    expect(seen[0][0]).toBe('query: headline number 0 about events')
    expect(seen[2][5]).toBe('query: headline number 69 about events')
  })

  it('returns [] for empty input without touching the extractor', async () => {
    seen.length = 0
    expect(await embedTitles([], fake)).toEqual([])
    expect(seen).toHaveLength(0)
  })
})
