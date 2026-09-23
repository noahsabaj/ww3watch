// Publisher-attached story photographs. RSS media, Open Graph, JSON-LD.
// A URL the newsroom published, or nothing — never a generated or stock image.
//
// Copied verbatim to supabase/functions/_shared/image.ts (Deno cannot import
// from src/). src/lib/cross-runtime.test.ts fails if the two files drift.

export type FeedImage = {
  url: string
  width: number | null
  height: number | null
}

export const MIN_IMAGE_WIDTH = 200
export const MIN_IMAGE_HEIGHT = 120
const MAX_URL_LEN = 2000
const NON_IMAGE_EXT = /\.(mp3|mp4|m4a|aac|wav|mov|webm|pdf|zip|xml|json)(\?|$)/i
const TRACKER =
  /pixel|1x1|spacer|tracking[-_]?pixel|scorecardresearch|doubleclick|facebook\.com\/tr|google-analytics|googletagmanager/i
// Social share cards: an image the publisher renders FROM the headline (often
// over a photo) for link previews. As a backdrop it prints the headline twice,
// the second copy fighting the first. RIA's /images/sharing/, Meduza's
// /imgly/share/, generic og-image renderers. Logos (TASS, Yonhap) fill the
// band with a wordmark instead of a photo. The plain photo, when a feed has
// one, still comes through its RSS media.
const SHARE_CARD =
  /\/(?:imgly\/)?shar(?:e|ing)\/|\/(?:api\/)?og(?:-image)?(?:\/|\.png|$)|\/opengraph-image|\/social[-_]?(?:card|image)|\/share[-_]?(?:card|image)|\/(?:[^/]*[^a-z/])?logo[^/]*\.(?:png|jpe?g|webp|svg|gif)$/i

export function sanitizeImageUrl(raw: unknown, baseUrl: string): string | null {
  if (typeof raw !== 'string') return null
  // Feeds and page markup often leave the query string HTML-escaped
  // (?fit=770%2C468&amp;ssl=1), which is a different URL.
  const trimmed = raw.trim().replace(/[\u0000-\u001F\u007F]/g, '').replace(/&amp;/gi, '&')
  if (!trimmed || trimmed.length > MAX_URL_LEN) return null
  let url: URL
  try {
    url = new URL(trimmed, baseUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (TRACKER.test(url.href) || NON_IMAGE_EXT.test(url.pathname)) return null
  if (SHARE_CARD.test(url.pathname)) return null
  return url.href
}

function dim(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw)
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }
  return null
}

export function acceptable(img: FeedImage): boolean {
  if (img.width != null && img.width < MIN_IMAGE_WIDTH) return false
  if (img.height != null && img.height < MIN_IMAGE_HEIGHT) return false
  return true
}

export function pickBestImage(candidates: FeedImage[]): FeedImage | null {
  const ok = candidates.filter(acceptable)
  if (!ok.length) return null
  ok.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))
  return ok[0]
}

function attr(node: unknown, name: string): unknown {
  if (node == null) return undefined
  if (typeof node === 'string') return name === 'url' || name === 'href' ? node : undefined
  if (typeof node !== 'object') return undefined
  const o = node as Record<string, unknown>
  if (o[name] != null) return o[name]
  const dollar = o.$
  if (dollar && typeof dollar === 'object') {
    const v = (dollar as Record<string, unknown>)[name]
    if (v != null) return v
  }
  const at = o[`@_${name}`]
  if (at != null) return at
  return undefined
}

function mediaCandidate(node: unknown, baseUrl: string): FeedImage | null {
  const medium = String(attr(node, 'medium') ?? '')
  const type = String(attr(node, 'type') ?? '')
  const kind = `${medium} ${type}`
  if (/video|audio/i.test(kind) && !/image/i.test(kind)) return null
  const url = sanitizeImageUrl(attr(node, 'url') ?? attr(node, 'href'), baseUrl)
  if (!url) return null
  return { url, width: dim(attr(node, 'width')), height: dim(attr(node, 'height')) }
}

function walkMedia(value: unknown, baseUrl: string, out: FeedImage[]): void {
  if (value == null) return
  if (Array.isArray(value)) {
    for (const v of value) walkMedia(v, baseUrl, out)
    return
  }
  const hit = mediaCandidate(value, baseUrl)
  if (hit) out.push(hit)
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (o['media:content']) walkMedia(o['media:content'], baseUrl, out)
    if (o['media:thumbnail']) walkMedia(o['media:thumbnail'], baseUrl, out)
    if (o.mediaContent) walkMedia(o.mediaContent, baseUrl, out)
    if (o.mediaThumbnail) walkMedia(o.mediaThumbnail, baseUrl, out)
    if (o.content && o.content !== value) walkMedia(o.content, baseUrl, out)
  }
}

const IMG_SRC = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi

function imagesFromHtml(html: string, baseUrl: string): FeedImage[] {
  const out: FeedImage[] = []
  for (const m of html.matchAll(IMG_SRC)) {
    const url = sanitizeImageUrl(m[1] ?? m[2] ?? m[3], baseUrl)
    if (url) out.push({ url, width: null, height: null })
  }
  return out
}

export function imagesFromRssItem(item: unknown, baseUrl: string): FeedImage[] {
  if (!item || typeof item !== 'object') return []
  const o = item as Record<string, unknown>
  const out: FeedImage[] = []
  walkMedia(o['media:content'] ?? o.mediaContent, baseUrl, out)
  walkMedia(o['media:thumbnail'] ?? o.mediaThumbnail, baseUrl, out)
  walkMedia(o['media:group'] ?? o.mediaGroup, baseUrl, out)
  walkMedia(o.enclosure, baseUrl, out)
  walkMedia(o.enclosures, baseUrl, out)
  const itunes = o.itunes
  if (itunes && typeof itunes === 'object') {
    const img = (itunes as Record<string, unknown>).image
    const url = sanitizeImageUrl(
      typeof img === 'string' ? img : attr(img, 'href') ?? attr(img, 'url'),
      baseUrl,
    )
    if (url) out.push({ url, width: null, height: null })
  }
  const links = Array.isArray(o.link) ? o.link : o.link ? [o.link] : []
  for (const l of links) {
    const rel = String(attr(l, 'rel') ?? '')
    const type = String(attr(l, 'type') ?? '')
    if (rel === 'enclosure' || type.startsWith('image/')) walkMedia(l, baseUrl, out)
  }
  for (const bit of [o['content:encoded'], o.content, o.description, o.summary]) {
    if (typeof bit === 'string' && /<img\b/i.test(bit)) out.push(...imagesFromHtml(bit, baseUrl))
  }
  return out
}

export function pickFeedImage(item: unknown, baseUrl: string): FeedImage | null {
  return pickBestImage(imagesFromRssItem(item, baseUrl))
}

const META = /<meta\b[^>]*>/gi

function metaAttr(tag: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = tag.match(re)
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null
}

function collectJsonLdImage(node: unknown, baseUrl: string, out: FeedImage[], depth: number): void {
  if (depth > 6 || node == null) return
  if (Array.isArray(node)) {
    for (const n of node) collectJsonLdImage(n, baseUrl, out, depth + 1)
    return
  }
  if (typeof node === 'string') {
    const url = sanitizeImageUrl(node, baseUrl)
    if (url) out.push({ url, width: null, height: null })
    return
  }
  if (typeof node !== 'object') return
  const o = node as Record<string, unknown>
  if (o.image != null) collectJsonLdImage(o.image, baseUrl, out, depth + 1)
  if (o.thumbnailUrl != null) collectJsonLdImage(o.thumbnailUrl, baseUrl, out, depth + 1)
  const url = sanitizeImageUrl(o.url ?? o.contentUrl, baseUrl)
  if (url && (o['@type'] === 'ImageObject' || typeof o.contentUrl === 'string')) {
    out.push({ url, width: dim(o.width), height: dim(o.height) })
  }
  if (o['@graph'] != null) collectJsonLdImage(o['@graph'], baseUrl, out, depth + 1)
}

function jsonLdImages(html: string, baseUrl: string): FeedImage[] {
  const out: FeedImage[] = []
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const m of html.matchAll(re)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(m[1].replace(/^\s*<!--|-->\s*$/g, '').trim())
    } catch {
      continue
    }
    collectJsonLdImage(parsed, baseUrl, out, 0)
  }
  return out
}

export function extractPageImage(html: string, baseUrl: string): FeedImage | null {
  const metas: { prop: string; content: string }[] = []
  for (const m of html.matchAll(META)) {
    const tag = m[0]
    const prop = (metaAttr(tag, 'property') ?? metaAttr(tag, 'name') ?? '').toLowerCase()
    const content = metaAttr(tag, 'content')
    if (prop && content) metas.push({ prop, content })
  }
  const og = metas.find((x) => x.prop === 'og:image' || x.prop === 'og:image:url')
  const tw = metas.find((x) => x.prop === 'twitter:image' || x.prop === 'twitter:image:src')
  const w = dim(metas.find((x) => x.prop === 'og:image:width')?.content)
  const h = dim(metas.find((x) => x.prop === 'og:image:height')?.content)
  const candidates: FeedImage[] = []
  if (og) {
    const url = sanitizeImageUrl(og.content, baseUrl)
    if (url) candidates.push({ url, width: w, height: h })
  }
  if (tw) {
    const url = sanitizeImageUrl(tw.content, baseUrl)
    if (url) candidates.push({ url, width: null, height: null })
  }
  candidates.push(...jsonLdImages(html, baseUrl))
  return pickBestImage(candidates)
}

export function dropChannelLogos<T extends {
  image_url: string | null
  image_width?: number | null
  image_height?: number | null
  image_fetched_at?: string | null
}>(articles: T[]): void {
  if (articles.length < 3) return
  const counts = new Map<string, number>()
  for (const a of articles) {
    if (a.image_url) counts.set(a.image_url, (counts.get(a.image_url) ?? 0) + 1)
  }
  for (const [url, n] of counts) {
    if (n < articles.length) continue
    for (const a of articles) {
      if (a.image_url !== url) continue
      a.image_url = null
      a.image_width = null
      a.image_height = null
      a.image_fetched_at = null
    }
  }
}
