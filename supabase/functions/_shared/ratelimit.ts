import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { corsHeaders } from './http.ts'

// IP extraction for Supabase Edge Functions (which sit behind Cloudflare).
// EMPIRICALLY VERIFIED (2026-06): a client that sends its own x-forwarded-for is
// IGNORED — Supabase's edge strips the inbound value and prepends the real
// source, and the right-most XFF hop is Supabase's OWN internal proxy (not the
// client). So:
//   1. Prefer `cf-connecting-ip` — a single, clean client IP set by Cloudflare
//      and not spoofable (CF overwrites any client-supplied value).
//   2. Fall back to the FIRST x-forwarded-for hop (the real source Supabase
//      prepends), NOT the right-most.
// Returns null when no trustworthy IP is found → callers fail CLOSED instead of
// lumping every header-less caller into one shared bucket.
export function isValidIp(ip: string): boolean {
  return ip.length > 0 && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip)
}

export function clientIp(req: Request): string | null {
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf && isValidIp(cf)) return cf
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (first && isValidIp(first)) return first
  return null
}

export function secondsToNextHour(nowMs: number = Date.now()): number {
  return Math.max(1, Math.ceil((3600_000 - (nowMs % 3600_000)) / 1000))
}

// Per-IP hourly limit. Returns a Response to short-circuit (429 over limit, 400
// when no client IP can be determined), or null to proceed. Fail-OPEN on limiter
// (RPC) errors — a bookkeeping hiccup must never take the feature down — but
// fail-CLOSED when there is no trustworthy IP to bucket on.
export async function rateLimited(
  supabase: SupabaseClient,
  req: Request,
  fn: string,
  limit: number,
): Promise<Response | null> {
  const ip = clientIp(req)
  if (!ip) {
    return new Response(JSON.stringify({ error: 'no_client_ip' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  try {
    const { data: allowed, error } = await supabase.rpc('check_rate_limit', {
      p_ip: ip,
      p_fn: fn,
      p_limit: limit,
    })
    if (error) {
      console.error(`[${fn}] rate-limit check failed (failing open):`, error)
      return null
    }
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(secondsToNextHour()) },
      })
    }
  } catch (err) {
    console.error(`[${fn}] rate-limit check failed (failing open):`, err)
  }
  return null
}

// Reject oversized request bodies before reading/parsing them — defense for the
// limiter's fail-open window. 64KB is well above any legitimate title+content.
export function tooLarge(req: Request, maxBytes = 64 * 1024): Response | null {
  const len = Number(req.headers.get('content-length') || '0')
  if (Number.isFinite(len) && len > maxBytes) {
    return new Response(JSON.stringify({ error: 'payload_too_large' }), {
      status: 413,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  return null
}
