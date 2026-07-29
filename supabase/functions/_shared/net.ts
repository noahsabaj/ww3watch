// SSRF guard for the reader. The articles.url gate narrows what can be requested,
// but a fetch still resolves DNS and follows redirects — so validate the host's
// resolved IPs against the private/link-local/loopback ranges, and re-validate
// every redirect hop (a public host can 30x to 169.254.169.254 / 127.0.0.1 / 10.x).
//
// CONTRACT: assertPublicUrl is the ONLY place that normalises a host (it strips
// the brackets WHATWG puts around an IPv6 hostname). Every predicate below takes
// a bare address and may assume it. Callers pass URL strings, so they get that
// normalisation for free — which is the point: the predicates were correct
// before and still let every IPv6 literal through, because nothing normalised.

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    n = (n << 8) | octet
  }
  return n >>> 0
}

export function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  if (n === null) return false
  const inRange = (base: string, bits: number) => {
    const baseInt = ipv4ToInt(base)!
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (n & mask) === (baseInt & mask)
  }
  return (
    inRange('0.0.0.0', 8) ||
    inRange('10.0.0.0', 8) ||
    inRange('100.64.0.0', 10) ||
    inRange('127.0.0.0', 8) ||
    inRange('169.254.0.0', 16) ||
    inRange('172.16.0.0', 12) ||
    inRange('192.0.0.0', 24) ||
    inRange('192.168.0.0', 16) ||
    inRange('198.18.0.0', 15)
  )
}

// Parse an IPv6 address into its 16 bytes, or null if it isn't one. Handles
// "::" compression and a trailing embedded IPv4 (::ffff:127.0.0.1).
//
// The predicates below range-check BYTES rather than matching string prefixes.
// Prefix matching is what produced two live bypasses: a bracketed host ("[::1]",
// which is how WHATWG serialises url.hostname) matched nothing, and an
// IPv4-mapped address ("::ffff:7f00:1", a form Deno.resolveDns returns) matched
// nothing either. Bytes have exactly one spelling; a prefix has many.
export function parseIpv6(raw: string): Uint8Array | null {
  const lower = raw.trim().toLowerCase()
  if (lower === '' || lower.includes(':::')) return null
  const halves = lower.split('::')
  if (halves.length > 2) return null

  // The final group may be a dotted-quad (embedded IPv4), worth two groups.
  const expand = (part: string): string[] | null => {
    if (part === '') return []
    const groups = part.split(':')
    const last = groups[groups.length - 1]
    if (last.includes('.')) {
      const n = ipv4ToInt(last)
      if (n === null) return null
      groups[groups.length - 1] = ((n >>> 16) & 0xffff).toString(16)
      groups.push((n & 0xffff).toString(16))
    }
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    }
    return groups
  }

  const head = expand(halves[0])
  const tail = halves.length === 2 ? expand(halves[1]) : []
  if (head === null || tail === null) return null

  const total = head.length + tail.length
  // Without "::" every group must be present; with it, at least one is elided.
  if (halves.length === 1 ? total !== 8 : total > 7) return null

  const groups = [...head, ...Array(8 - total).fill('0'), ...tail]
  const bytes = new Uint8Array(16)
  groups.forEach((g, i) => {
    const v = parseInt(g, 16)
    bytes[i * 2] = v >>> 8
    bytes[i * 2 + 1] = v & 0xff
  })
  return bytes
}

// Loopback, unspecified, link-local, unique-local — plus any address that
// merely wraps an IPv4 one, which routes to that v4 address and so inherits the
// v4 rules (::ffff:127.0.0.1 and the deprecated ::127.0.0.1 both reach lo).
//
// DELIBERATE DEPARTURE: 6to4 (2002::/16), Teredo (2001::/32) and NAT64
// (64:ff9b::/96) also embed a v4 address but are NOT blocked. Reaching a
// private host through one requires a cooperating relay, and blocking them
// risks refusing a legitimate origin. This is a decision, not an oversight —
// do not "fix" it without deciding again.
export function isBlockedIpv6(ip: string): boolean {
  const b = parseIpv6(ip)
  if (b === null) return false
  const zeros = (upTo: number) => b.slice(0, upTo).every((x) => x === 0)
  // ::/96 (covers :: and ::1) and ::ffff:0:0/96 — both carry a v4 address in
  // the low 32 bits, so hand it to the v4 rules rather than duplicating them.
  if (zeros(12) || (zeros(10) && b[10] === 0xff && b[11] === 0xff)) {
    return isPrivateIpv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`)
  }
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true // fe80::/10, not just "fe80"
  if ((b[0] & 0xfe) === 0xfc) return true // fc00::/7
  return false
}

// One address check for both literals and DNS answers. Fails CLOSED: an address
// we cannot parse is treated as blocked, so a form nobody anticipated can never
// become the next bypass.
function isBlockedIp(ip: string): boolean {
  if (!ip.includes(':')) return isPrivateIpv4(ip)
  return parseIpv6(ip) === null ? true : isBlockedIpv6(ip)
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('invalid_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid_url')
  // WHATWG serialises an IPv6 host WITH brackets — url.hostname for
  // http://[::1]/ is the string "[::1]". Strip them ONCE, here, so no predicate
  // downstream can ever be handed a bracketed form. This single normalisation
  // point is the fix; the byte checks below are what it protects.
  const hostname = url.hostname.toLowerCase()
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('blocked_host')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIpv4(host)) throw new Error('blocked_host')
    return url
  }
  if (host.includes(':')) {
    // A colon means it can only be an IP literal — never a resolvable hostname.
    // Unparseable ⇒ reject, rather than falling through to the DNS branch where
    // a failed lookup would let it past.
    if (parseIpv6(host) === null) throw new Error('invalid_url')
    if (isBlockedIpv6(host)) throw new Error('blocked_host')
    return url
  }
  try {
    const [a, aaaa] = await Promise.allSettled([Deno.resolveDns(host, 'A'), Deno.resolveDns(host, 'AAAA')])
    const ips = [
      ...(a.status === 'fulfilled' ? a.value : []),
      ...(aaaa.status === 'fulfilled' ? aaaa.value : []),
    ]
    for (const ip of ips) {
      if (isBlockedIp(ip)) throw new Error('blocked_host')
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'blocked_host') throw err
  }
  return url
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

// Fetch with the SSRF guard applied to the initial URL AND every redirect target.
// redirect:'manual' so we re-run assertPublicUrl on each Location before following
// (default auto-follow would let a public host bounce to a private one). Caps hops.
export async function fetchGuarded(rawUrl: string, timeoutMs: number, maxRedirects = 3): Promise<Response> {
  let url = await assertPublicUrl(rawUrl)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      // Re-validate the redirect target (resolve relative against the current URL).
      url = await assertPublicUrl(new URL(loc, url).toString())
      continue
    }
    return res
  }
  throw new Error('too_many_redirects')
}
