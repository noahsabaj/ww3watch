// SSRF guard for the reader. The articles.url gate narrows what can be requested,
// but a fetch still resolves DNS and follows redirects — so validate the host's
// resolved IPs against the private/link-local/loopback ranges, and re-validate
// every redirect hop (a public host can 30x to 169.254.169.254 / 127.0.0.1 / 10.x).

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

export function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  return lower === '::1' || lower === '::' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('invalid_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid_url')
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('blocked_host')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateIpv4(host)) throw new Error('blocked_host')
    return url
  }
  if (host.includes(':')) {
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
      if (ip.includes(':') ? isBlockedIpv6(ip) : isPrivateIpv4(ip)) throw new Error('blocked_host')
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
