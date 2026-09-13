// Reader fallbacks for pages Readability gets wrong.
//
// Readability picks the densest text block, which on some news sites (nav-heavy
// Persian dailies, paywalled layouts) is a menu or a related-links list — the
// extraction "succeeds" as a list of links. Most such sites still embed the full
// body as NewsArticle JSON-LD for search engines; this pulls it out. Pure string
// functions, no DOM, so the Deno test suite covers them without linkedom.

export type FallbackArticle = { title: string; byline: string | null; content: string }

// Share of the extracted text that sits inside <a> elements. Above
// LINK_DENSE_RATIO the "article" is a link list, not prose.
export const LINK_DENSE_RATIO = 0.5
// Floor for a usable article (the reader already refused to cache below it).
export const MIN_TEXT_CHARS = 200

const TAG_RE = /<[^>]+>/g
const ENTITY_RE = /&(#x?[0-9a-f]+|[a-z]+);/gi
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(TAG_RE, ' ')
    .replace(ENTITY_RE, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return NAMED[e.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

export function linkDensity(html: string): number {
  const total = htmlToText(html).length
  if (total === 0) return 0
  let linked = 0
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) linked += htmlToText(m[1]).length
  return Math.min(1, linked / total)
}

// True when a Readability result should be replaced by a fallback if one exists.
export function looksLikeJunk(contentHtml: string, textLen: number): boolean {
  return textLen < MIN_TEXT_CHARS || linkDensity(contentHtml) > LINK_DENSE_RATIO
}

const ARTICLE_TYPES = new Set([
  'NewsArticle', 'Article', 'ReportageNewsArticle', 'BlogPosting',
  'AnalysisNewsArticle', 'BackgroundNewsArticle', 'OpinionNewsArticle',
])

function isArticleNode(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== 'object') return false
  const t = (node as Record<string, unknown>)['@type']
  const types = Array.isArray(t) ? t : [t]
  return types.some((x) => typeof x === 'string' && ARTICLE_TYPES.has(x))
}

// Walk a JSON-LD document (object, array, or @graph) for the first article node
// carrying an articleBody.
function findArticleNode(root: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4 || !root || typeof root !== 'object') return null
  if (Array.isArray(root)) {
    for (const item of root) {
      const hit = findArticleNode(item, depth + 1)
      if (hit) return hit
    }
    return null
  }
  const obj = root as Record<string, unknown>
  if (isArticleNode(obj) && typeof obj.articleBody === 'string' && obj.articleBody.trim()) return obj
  return findArticleNode(obj['@graph'], depth + 1)
}

function authorName(author: unknown): string | null {
  if (!author) return null
  if (typeof author === 'string') return author.trim() || null
  if (Array.isArray(author)) {
    const names = author.map(authorName).filter((n): n is string => !!n)
    return names.length ? names.join(', ') : null
  }
  if (typeof author === 'object') {
    const name = (author as Record<string, unknown>).name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  }
  return null
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Paragraphs from a plain-text body: JSON-LD articleBody is newline-separated
// (sometimes double), occasionally one long line. Output is plain <p> markup —
// the client sanitizes at {@html} regardless.
export function bodyToHtml(body: string): string {
  const paras = body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  return paras.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')
}

const LD_SCRIPT_RE = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

// The NewsArticle JSON-LD body of a page, or null when there is none.
export function fallbackArticle(html: string): FallbackArticle | null {
  for (const m of html.matchAll(LD_SCRIPT_RE)) {
    let parsed: unknown
    try {
      // Some CMSes leave an HTML comment or CDATA wrapper inside the script.
      parsed = JSON.parse(
        m[1].replace(/^\s*<!--|-->\s*$/g, '').replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, '').trim(),
      )
    } catch {
      continue
    }
    const node = findArticleNode(parsed)
    if (!node) continue
    const body = node.articleBody as string
    if (htmlToText(body).length < MIN_TEXT_CHARS) continue
    const headline = typeof node.headline === 'string' ? node.headline.trim() : ''
    return { title: headline, byline: authorName(node.author), content: bodyToHtml(body) }
  }
  return null
}
