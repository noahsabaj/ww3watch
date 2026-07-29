import { assertEquals } from 'jsr:@std/assert@1'
import { countEchoed, selectWithinBudget } from './segments.ts'

Deno.test('selectWithinBudget takes everything when it fits', () => {
  assertEquals(selectWithinBudget(['aaa', 'bbb', 'ccc'], 100, 50), [0, 1, 2])
})

// The defect this replaces: a 100-SEGMENT cap silently dropped the tail of a
// long article. The budget stops instead, and the caller echoes the rest — so
// the reader gets the whole article back, part of it untranslated, rather than
// an article that ends early.
Deno.test('selectWithinBudget stops at the budget rather than skipping ahead', () => {
  // The later 'dd' WOULD still fit in the 2 remaining chars. Taking it would
  // translate paragraphs 0, 1 and 4 while leaving 2-3 in the original language —
  // an article with a hole in the middle. Stop at the first thing that doesn't
  // fit so the untranslated part is always a contiguous tail.
  //              0(4)    1(4)    2(8)        3(2)
  const segs = ['aaaa', 'bbbb', 'cccccccc', 'dd']
  assertEquals(selectWithinBudget(segs, 10, 50), [0, 1])
})

Deno.test('selectWithinBudget skips blank and oversized segments without cutting the article short', () => {
  //                 0        1     2 (oversized)   3        4
  const segs = ['hello', '   ', 'x'.repeat(60), 'world', 'again']
  // The oversized one is echoed, not a stopping point — 3 and 4 still translate.
  assertEquals(selectWithinBudget(segs, 100, 50), [0, 3, 4])
})

Deno.test('selectWithinBudget handles the empty and all-oversized cases', () => {
  assertEquals(selectWithinBudget([], 100, 50), [])
  assertEquals(selectWithinBudget(['x'.repeat(80)], 100, 50), [])
  assertEquals(selectWithinBudget(['x'.repeat(80)], 0, 50), [])
})

Deno.test('countEchoed counts segments returned unchanged, ignoring blanks', () => {
  const input = ['one', 'two', '  ', 'four']
  const output = ['uno', 'two', '  ', 'cuatro']
  assertEquals(countEchoed(input, output), 1) // only 'two' came back as-is
})

Deno.test('countEchoed reports a fully untranslated tail', () => {
  const input = ['a', 'b', 'c', 'd']
  const output = ['A', 'B', 'c', 'd'] // budget ran out after two
  assertEquals(countEchoed(input, output), 2)
})

Deno.test('countEchoed is zero when everything was translated', () => {
  assertEquals(countEchoed(['a', 'b'], ['A', 'B']), 0)
})
