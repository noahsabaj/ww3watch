import { assert, assertEquals } from 'jsr:@std/assert@1'
import { clientIp, isValidIp, secondsToNextHour } from './ratelimit.ts'

const reqWith = (headers: Record<string, string>) => new Request('https://x/', { headers })

Deno.test('clientIp prefers cf-connecting-ip over x-forwarded-for', () => {
  assertEquals(
    clientIp(reqWith({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '9.9.9.9, 13.248.1.1' })),
    '203.0.113.7',
  )
})

Deno.test('clientIp falls back to the FIRST x-forwarded-for hop (Supabase prepends real source)', () => {
  // The right-most (13.248.x) is Supabase's internal proxy — must NOT be chosen.
  assertEquals(clientIp(reqWith({ 'x-forwarded-for': '203.0.113.7, 13.248.1.1' })), '203.0.113.7')
})

Deno.test('clientIp fails closed (null) with no trustworthy IP', () => {
  assertEquals(clientIp(reqWith({})), null)
  assertEquals(clientIp(reqWith({ 'x-forwarded-for': 'garbage-host' })), null)
})

Deno.test('isValidIp accepts IPv4/IPv6, rejects empty / overlong / injection', () => {
  assert(isValidIp('1.2.3.4'))
  assert(isValidIp('2001:db8::1'))
  assert(!isValidIp(''))
  assert(!isValidIp('a'.repeat(60)))
  assert(!isValidIp('1.2.3.4; drop'))
})

Deno.test('secondsToNextHour bounds', () => {
  assertEquals(secondsToNextHour(0), 3600) // exactly on the hour
  assertEquals(secondsToNextHour(3600_000 + 1000), 3599) // 1s past the hour
})
