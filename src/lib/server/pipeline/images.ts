// Fill image_url for recent articles whose RSS item had no photograph.
// Worklist: image_fetched_at IS NULL. A stamp (url or not) takes the row off
// the list so we do not hammer Al Jazeera every run.
//
// Only a page we actually READ is a verdict. A timeout, a 403 from a WAF or a
// DNS failure says nothing about whether the newsroom published a photo, so
// those rows stay NULL and the next run tries again; the lookback window
// (IMAGE_FILL_LOOKBACK_HOURS) is what eventually retires a page that never
// answers.
import { isIP } from 'node:net'
import { supabaseAdmin } from '../supabase'
import { extractPageImage } from '../image'
import { mapPool } from '../pool'
import {
  IMAGE_FILL_CAP,
  IMAGE_FILL_CONCURRENCY,
  IMAGE_FILL_LOOKBACK_HOURS,
  IMAGE_FILL_TIMEOUT_MS,
} from '../config'
import { bump, type RunStats } from './stats'

// og:image and JSON-LD live in <head>; nothing past this is needed.
const MAX_PAGE_BYTES = 400_000
const MAX_REDIRECTS = 3

function proxyConfig(): { url: string; secret: string } | null {
  const url = process.env.FEED_PROXY_URL
  const secret = process.env.FEED_PROXY_SECRET
  return url && secret ? { url, secret } : null
}

const PAGE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

// Article URLs come from third-party feeds and this fetch runs on the
// pipeline's runner, so a feed must not be able to point it at loopback,
// private, link-local or cloud-metadata addresses. Checked on every redirect
// hop. (Names that resolve to private addresses are not caught here; the
// response is only ever mined for an image URL, never returned.)
export function isFetchableArticleUrl(href: string): boolean {
  let u: URL
  try { u = new URL(href) } catch { return false }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password) return false
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return false
  const kind = isIP(host)
  if (kind === 4) return !privateV4(host)
  if (kind === 6) {
    // IPv4-mapped: the URL parser normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1.
    const dotted = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (dotted) return !privateV4(dotted[1])
    const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)]
      return !privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
    }
    return !(host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host))
  }
  return true
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  await reader.cancel().catch(() => {})
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_PAGE_BYTES))
}

async function fetchDirect(url: string): Promise<string | null> {
  let href = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableArticleUrl(href)) return null
    const res = await fetch(href, { headers: PAGE_HEADERS, redirect: 'manual', signal: AbortSignal.timeout(IMAGE_FILL_TIMEOUT_MS) })
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (next) {
      await res.body?.cancel().catch(() => {})
      href = new URL(next, href).toString()
      continue
    }
    return res.ok ? readCapped(res) : null
  }
  return null
}

/** The page's HTML, or null when we could not read it (not a verdict). */
async function fetchHtml(url: string): Promise<string | null> {
  if (!isFetchableArticleUrl(url)) return null
  const proxy = proxyConfig()
  if (proxy) {
    try {
      const res = await fetch(`${proxy.url}?url=${encodeURIComponent(url)}`, {
        headers: { ...PAGE_HEADERS, 'x-proxy-key': proxy.secret },
        signal: AbortSignal.timeout(IMAGE_FILL_TIMEOUT_MS),
      })
      if (res.ok) return await readCapped(res)
      await res.body?.cancel().catch(() => {})
    } catch {
      // fall through to direct
    }
  }
  try {
    return await fetchDirect(url)
  } catch {
    return null
  }
}

class Unreadable extends Error {}

export async function fillMissingImages(stats: RunStats, deadlineMs: number): Promise<void> {
  try {
    const since = new Date(Date.now() - IMAGE_FILL_LOOKBACK_HOURS * 3600_000).toISOString()
    const { data, error } = await supabaseAdmin
      .from('articles')
      .select('id, url')
      .is('image_fetched_at', null)
      .gte('published_at', since)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(IMAGE_FILL_CAP)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    if (rows.length === 0) return

    const result = await mapPool(
      rows,
      IMAGE_FILL_CONCURRENCY,
      async (row) => {
        // A URL we will never fetch is a verdict (no photo); a page that did
        // not answer is not — leave it NULL so the next run retries it.
        const html = isFetchableArticleUrl(row.url) ? await fetchHtml(row.url) : ''
        if (html === null) throw new Unreadable(row.url)
        const image = html ? extractPageImage(html, row.url) : null
        const { error: updateError } = await supabaseAdmin
          .from('articles')
          .update({
            image_url: image?.url ?? null,
            image_width: image?.width ?? null,
            image_height: image?.height ?? null,
            image_fetched_at: new Date().toISOString(),
          })
          .eq('id', row.id)
        if (updateError) throw new Error(updateError.message)
        return image
      },
      { deadlineMs },
    )

    const unreadable = result.failed.filter((f) => f.error instanceof Unreadable).length
    bump(stats, 'images_filled', result.done.filter((d) => d.value).length)
    bump(stats, 'images_none', result.done.filter((d) => !d.value).length)
    bump(stats, 'images_unreadable', unreadable)
    bump(stats, 'images_deferred', result.skipped.length)
    bump(stats, 'images_failed', result.failed.length - unreadable)
    console.log(
      `[pipeline] images: filled=${stats.images_filled ?? 0} none=${stats.images_none ?? 0} ` +
        `unreadable=${stats.images_unreadable ?? 0} (retried next run) failed=${stats.images_failed ?? 0}`,
    )
  } catch (err) {
    stats.images_error = String(err).slice(0, 200)
    console.error('[pipeline] image fill failed (non-fatal):', err)
  }
}
