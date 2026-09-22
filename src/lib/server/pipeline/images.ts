// Fill image_url for recent articles whose RSS item had no photograph.
// Worklist: image_fetched_at IS NULL. A stamp (url or not) takes the row off
// the list so we do not hammer Al Jazeera every run. Failures are not a
// verdict — the next run retries anything still NULL.
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

async function fetchHtml(url: string): Promise<string | null> {
  const tryOnce = async (href: string, headers: Record<string, string>) => {
    const res = await fetch(href, { headers, signal: AbortSignal.timeout(IMAGE_FILL_TIMEOUT_MS) })
    if (!res.ok) return null
    return (await res.text()).slice(0, 400_000)
  }
  const proxy = proxyConfig()
  if (proxy) {
    try {
      const viaProxy = await tryOnce(`${proxy.url}?url=${encodeURIComponent(url)}`, {
        ...PAGE_HEADERS,
        'x-proxy-key': proxy.secret,
      })
      if (viaProxy) return viaProxy
    } catch {
      // fall through to direct
    }
  }
  try {
    return await tryOnce(url, PAGE_HEADERS)
  } catch {
    return null
  }
}

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
        const html = await fetchHtml(row.url)
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

    bump(stats, 'images_filled', result.done.filter((d) => d.value).length)
    bump(stats, 'images_none', result.done.filter((d) => !d.value).length)
    bump(stats, 'images_failed', result.failed.length)
    if (result.skipped.length) bump(stats, 'images_failed', result.skipped.length)
    console.log(
      `[pipeline] images: filled=${stats.images_filled ?? 0} none=${stats.images_none ?? 0} failed=${stats.images_failed ?? 0}`,
    )
  } catch (err) {
    stats.images_error = String(err).slice(0, 200)
    console.error('[pipeline] image fill failed (non-fatal):', err)
  }
}
