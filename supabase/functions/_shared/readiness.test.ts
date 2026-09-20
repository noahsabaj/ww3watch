import { assertEquals, assert } from 'jsr:@std/assert@1'
import { boundedJson } from './body.ts'
import { privateBucket } from './identity.ts'
import { readerSegments } from './reader-segments.ts'

Deno.test('stream byte limit applies without Content-Length', async () => {
  const req = new Request('https://example.test', {method:'POST',body:JSON.stringify({value:'界'.repeat(100)})})
  const result = await boundedJson(req,100)
  assert(result instanceof Response)
  assertEquals(result.status,413)
})
Deno.test('invalid JSON and arrays are rejected', async () => {
  for (const body of ['{','[]','null']) {
    const result = await boundedJson(new Request('https://example.test',{method:'POST',body}))
    assert(result instanceof Response); assertEquals(result.status,400)
  }
})
Deno.test('abuse identifiers rotate by date and key', async () => {
  const a = await privateBucket('203.0.113.7','first','2026-09-20')
  assert(a !== await privateBucket('203.0.113.7','first','2026-09-21'))
  assert(a !== await privateBucket('203.0.113.7','second','2026-09-20'))
  assert(!a.includes('203.0.113.7'))
})
Deno.test('reader reconstruction changes text, preserving markup and escaping model HTML', () => {
  const value = readerSegments('<p>Hello <a href="/source">world</a>!</p><img src="/a.jpg"><script>never translate</script>')
  assertEquals(value.segments,['Hello','world','!'])
  const result = value.render(['<script>bad</script>','mundo','!'])
  assert(result.includes('&lt;script&gt;bad&lt;/script&gt;'))
  assert(result.includes('href="/source"'))
  assert(result.includes('src="/a.jpg"'))
})
