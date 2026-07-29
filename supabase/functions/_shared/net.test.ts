import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { assertPublicUrl, fetchGuarded, ipv4ToInt, isBlockedIpv6, isPrivateIpv4 } from './net.ts'

Deno.test('ipv4ToInt parses valid and rejects malformed', () => {
  assertEquals(ipv4ToInt('0.0.0.0'), 0)
  assertEquals(ipv4ToInt('255.255.255.255'), 0xffffffff)
  assertEquals(ipv4ToInt('1.2.3.4'), 0x01020304)
  assertEquals(ipv4ToInt('256.0.0.1'), null) // octet overflow
  assertEquals(ipv4ToInt('1.2.3'), null) // too few octets
  assertEquals(ipv4ToInt('1.2.3.4.5'), null) // too many
})

Deno.test('isPrivateIpv4 blocks reserved ranges, allows public (boundary-checked)', () => {
  const blocked = [
    '0.0.0.0', '10.0.0.1', '10.255.255.255', '100.64.0.1', '127.0.0.1',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '198.18.0.1',
  ]
  for (const ip of blocked) assert(isPrivateIpv4(ip), `${ip} should be blocked`)

  const allowed = [
    '8.8.8.8', '1.1.1.1', '93.184.216.34',
    '172.15.255.255', '172.32.0.1', // just outside 172.16/12
    '100.63.255.255', '100.128.0.0', // just outside 100.64/10
  ]
  for (const ip of allowed) assert(!isPrivateIpv4(ip), `${ip} should be public`)
})

Deno.test('isBlockedIpv6 blocks loopback / link-local / ULA', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'FE80::ABCD']) {
    assert(isBlockedIpv6(ip), `${ip} should be blocked`)
  }
  for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111']) {
    assert(!isBlockedIpv6(ip), `${ip} should be allowed`)
  }
})

// The forms Deno.resolveDns(host, 'AAAA') can legitimately return that the
// original prefix-matching implementation did not recognise. An IPv4-mapped
// address routes to the embedded v4 address, so the v4 rules must apply to it;
// link-local is fe80::/10, which spans fe80–febf and not just the literal
// prefix "fe80".
Deno.test('isBlockedIpv6 blocks IPv4-mapped and the full fe80::/10 range', () => {
  const blocked = [
    '::ffff:127.0.0.1',   // mapped loopback, dotted form
    '::ffff:7f00:1',      // the same address as Deno/WHATWG serialise it
    '::ffff:169.254.169.254', // mapped link-local metadata address
    '::ffff:10.0.0.1',    // mapped RFC1918
    '::127.0.0.1',        // deprecated v4-compatible form
    'fe90::1',            // still fe80::/10
    'febf:ffff::1',       // last address in fe80::/10
    '0:0:0:0:0:0:0:1',    // uncompressed loopback
  ]
  for (const ip of blocked) assert(isBlockedIpv6(ip), `${ip} should be blocked`)

  const allowed = [
    '::ffff:8.8.8.8',     // mapped PUBLIC v4 — must stay reachable
    'fec0::1',            // site-local, deprecated, outside fe80::/10
    '2001:4860:4860::8888',
  ]
  for (const ip of allowed) assert(!isBlockedIpv6(ip), `${ip} should be allowed`)
})

// The boundary callers actually cross. assertPublicUrl receives a URL STRING,
// and reads url.hostname — which WHATWG serialises WITH brackets for IPv6
// ("[::1]"). Testing only the bare-string predicate is what let every IPv6
// literal through a green suite.
Deno.test('assertPublicUrl rejects IPv6 literals at the URL boundary', async () => {
  const blocked = [
    'http://[::1]/x',
    'http://[0:0:0:0:0:0:0:1]/x',
    'http://[::ffff:127.0.0.1]/x',
    'http://[::ffff:169.254.169.254]/x',
    'http://[fe80::1]/x',
    'http://[fd00::1]/x',
    'https://[::1]:8000/admin',
  ]
  for (const raw of blocked) {
    await assertRejects(() => assertPublicUrl(raw), Error, 'blocked_host', `${raw} should be blocked`)
  }
})

Deno.test('assertPublicUrl still allows public IPv6 and public IPv4 literals', async () => {
  for (const raw of ['http://[2606:4700:4700::1111]/x', 'http://8.8.8.8/x']) {
    const url = await assertPublicUrl(raw)
    assertEquals(url.href.startsWith('http'), true)
  }
})

// LIVE REPRO. Binds a real listener on ::1 and asks fetchGuarded for it. Before
// the byte-parsing fix this returns the listener's body — a working SSRF read
// primitive; fetchGuarded re-runs assertPublicUrl on every redirect Location,
// so the same hole let any ingested origin 30x into loopback.
// Needs network permission to bind the listener — CI grants exactly `[::1]`
// (see .github/workflows/ci.yml). Per-test `permissions` can only narrow the
// process grant, never escalate to it, so this inherits rather than requests.
Deno.test({
  name: 'LIVE: fetchGuarded cannot reach a loopback listener via an IPv6 literal',
  fn: async () => {
    const ac = new AbortController()
    const server = Deno.serve(
      { hostname: '::1', port: 0, signal: ac.signal, onListen: () => {} },
      () => new Response('INTERNAL-SERVICE-SECRET'),
    )
    const port = (server.addr as Deno.NetAddr).port
    try {
      const err = await assertRejects(
        () => fetchGuarded(`http://[::1]:${port}/`, 3000),
        Error,
      )
      assertEquals(
        err.message,
        'blocked_host',
        `fetchGuarded reached the loopback listener instead of blocking it (got: ${err.message})`,
      )
    } finally {
      ac.abort()
      await server.finished
    }
  },
})
