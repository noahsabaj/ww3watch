// Supabase Edge Function: article reader/extractor (Deno).
// Ports src/lib/server/reader.ts. Fetches a user-supplied URL, extracts the
// readable article with Mozilla Readability, and returns it. Guarded against SSRF.
//
// The returned HTML is sanitized authoritatively on the CLIENT with DOMPurify
// (src/lib/sanitize-html.ts) right before {@html} in ArticlePanel — DOMPurify
// needs a real DOM, which is reliable in the browser but not in Deno.
//
// Self-contained (cors + ssrf inlined) so it deploys as a single file.

import { Readability } from 'npm:@mozilla/readability@0.6'
import { parseHTML } from 'npm:linkedom@0.18'

// ── CORS ─────────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// ── SSRF guard ───────────────────────────────────────────────────────────────
// Refuse anything pointing at private/internal space (cloud metadata at
// 169.254.169.254, localhost, RFC1918, etc.). We check the literal host and also
// resolve the hostname and reject if any resolved IP is private.
function ipv4ToInt(ip: string): number | null {
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
function isPrivateIpv4(ip: string): boolean {
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
    inRange('169.254.0.0', 16) || // link-local (incl. cloud metadata)
    inRange('172.16.0.0', 12) ||
    inRange('192.0.0.0', 24) ||
    inRange('192.168.0.0', 16) ||
    inRange('198.18.0.0', 15)
  )
}
function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  return lower === '::1' || lower === '::' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')
}
async function assertPublicUrl(raw: string): Promise<URL> {
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
    // DNS failure: let fetch attempt and fail naturally rather than false-block.
  }
  return url
}

// ── Handler ──────────────────────────────────────────────────────────────────
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // supabase.functions.invoke() sends a POST with a JSON body; also accept a
  // ?url= query param for easy curl testing.
  let articleUrl: string | null = new URL(req.url).searchParams.get('url')
  if (!articleUrl && req.method === 'POST') {
    try {
      const body = await req.json()
      if (typeof body?.url === 'string') articleUrl = body.url
    } catch {
      // fall through to missing_url
    }
  }
  if (!articleUrl) return json({ error: 'missing_url' }, 400)

  let target: URL
  try {
    target = await assertPublicUrl(articleUrl)
  } catch {
    return json({ error: 'invalid_url' }, 400)
  }

  let html: string
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return json({ error: 'extraction_failed' }, 422)
    html = await res.text()
  } catch {
    return json({ error: 'extraction_failed' }, 422)
  }

  try {
    const { document } = parseHTML(html)
    const article = new Readability(document as unknown as Document).parse()
    if (!article) return json({ error: 'extraction_failed' }, 422)
    return json({
      title: article.title ?? '',
      byline: article.byline ?? null,
      content: article.content ?? '',
      siteName: article.siteName ?? null,
    })
  } catch {
    return json({ error: 'extraction_failed' }, 422)
  }
})
