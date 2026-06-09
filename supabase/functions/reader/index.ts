// Supabase Edge Function: article reader/extractor (Deno).
// Fetches a known article's URL, extracts the readable article with Mozilla
// Readability, and returns it. Guarded against SSRF; results are cached in
// public.article_content (instant repeat opens + survives source takedowns).
// The returned HTML is sanitized on the CLIENT with DOMPurify before {@html}.
//
// verify_jwt is off (the publishable key is not a JWT), so the abuse control is
// the articles.url gate: only URLs the pipeline ingested are fetched or cached.

import { Readability } from 'npm:@mozilla/readability@0.6'
import { parseHTML } from 'npm:linkedom@0.18'
import { createClient } from 'npm:@supabase/supabase-js@2'

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

// Service client from Supabase's auto-injected env: prefer the new secret-keys
// dict, fall back to the legacy service-role key.
function secretKey(): string {
  const dict = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (dict) {
    try {
      const parsed = JSON.parse(dict)
      if (typeof parsed?.default === 'string') return parsed.default
    } catch {
      // fall through
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
  auth: { persistSession: false },
})

const MAX_CACHE_CONTENT_CHARS = 400_000

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
    inRange('169.254.0.0', 16) ||
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
  }
  return url
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  let articleUrl: string | null = new URL(req.url).searchParams.get('url')
  if (!articleUrl && req.method === 'POST') {
    try {
      const body = await req.json()
      if (typeof body?.url === 'string') articleUrl = body.url
    } catch {
      // fall through
    }
  }
  if (!articleUrl) return json({ error: 'missing_url' }, 400)

  // Gate: only URLs the pipeline ingested. Blocks cache-stuffing and limits the
  // SSRF/proxy surface to our own article set.
  const { data: known, error: gateError } = await supabase
    .from('articles')
    .select('url')
    .eq('url', articleUrl)
    .limit(1)
  if (gateError) console.error('[reader] gate lookup failed:', gateError)
  if (!known?.length) return json({ error: 'unknown_article' }, 404)

  // Cache hit → instant, and survives source-page takedowns.
  const { data: cached } = await supabase
    .from('article_content')
    .select('title, byline, content, site_name')
    .eq('url', articleUrl)
    .maybeSingle()
  if (cached) {
    return json({
      title: cached.title,
      byline: cached.byline,
      content: cached.content,
      siteName: cached.site_name,
      cached: true,
    })
  }

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

    const result = {
      title: article.title ?? '',
      byline: article.byline ?? null,
      content: article.content ?? '',
      siteName: article.siteName ?? null,
    }

    // Cache write is best-effort — never fail the response over it.
    if (result.content && result.content.length <= MAX_CACHE_CONTENT_CHARS) {
      const { error: cacheError } = await supabase.from('article_content').upsert(
        {
          url: articleUrl,
          title: result.title,
          byline: result.byline,
          content: result.content,
          site_name: result.siteName,
        },
        { onConflict: 'url', ignoreDuplicates: true },
      )
      if (cacheError) console.error('[reader] cache write failed:', cacheError)
    }

    return json(result)
  } catch {
    return json({ error: 'extraction_failed' }, 422)
  }
})
