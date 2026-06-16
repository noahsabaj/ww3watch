import { assert, assertEquals } from 'jsr:@std/assert@1'
import { ipv4ToInt, isPrivateIpv4, isBlockedIpv6 } from './net.ts'

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
