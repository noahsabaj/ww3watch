import { assert, assertEquals } from 'jsr:@std/assert@1'
import { isSupportedTarget, translationCacheParts } from './lang.ts'

Deno.test('isSupportedTarget gates the allowlist', () => {
  assert(isSupportedTarget('ru'))
  assert(isSupportedTarget('en'))
  assert(isSupportedTarget('ar'))
  assert(!isSupportedTarget('xx'))
  assert(!isSupportedTarget(undefined))
  assert(!isSupportedTarget(123))
  // Must not be fooled by inherited Object props.
  assert(!isSupportedTarget('toString'))
})

Deno.test('English cache key is byte-identical to the legacy formula (cache reuse)', () => {
  const SEP = String.fromCharCode(31)
  assertEquals(translationCacheParts('fa', 'en', 'Title', 'Body'), ['fa', 'Title', 'Body'].join(SEP))
})

Deno.test('non-English targets get a distinct cache namespace (no cross-serving)', () => {
  const SEP = String.fromCharCode(31)
  const ru = translationCacheParts('fa', 'ru', 'Title', 'Body')
  const en = translationCacheParts('fa', 'en', 'Title', 'Body')
  assert(ru !== en)
  assertEquals(ru, ['fa', 'ru', 'Title', 'Body'].join(SEP))
})
