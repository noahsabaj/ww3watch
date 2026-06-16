// Client-side HTML sanitizer + URL fixer — the single authority at the {@html}
// sink in ArticlePanel (server-side DOMPurify was a silent no-op in Deno, so
// the browser is where safety lives). Running at the sink also means cached
// article HTML gets every upgrade here retroactively.
//
// Beyond sanitizing, the hook fixes extracted-page URLs: sources keep relative
// hrefs/srcs which would otherwise resolve against OUR origin (hijacking the
// SPA into broken routes, 404ing images), and reader links must open in a new
// tab rather than navigate the app.

import DOMPurify from 'dompurify'

export const SANITIZE_CONFIG = { USE_PROFILES: { html: true } } as const

// Base URL for the current cleanHtml call. DOMPurify hooks are global and
// sanitize() is synchronous, so per-call state lives here (reset in finally).
let currentBase: string | null = null

function absolutize(el: Element, attr: 'href' | 'src') {
  const value = el.getAttribute(attr)
  if (!value || !currentBase) return
  try {
    el.setAttribute(attr, new URL(value, currentBase).toString())
  } catch {
    el.removeAttribute(attr)
  }
}

// DOM-less DOMPurify (no window) is a stub without addHook — guard so importing
// this module outside a DOM environment can't crash.
if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    absolutize(node, 'href')
    absolutize(node, 'src')
    // srcset would need per-candidate rewriting; src is enough for the reader.
    if (node.hasAttribute('srcset')) node.removeAttribute('srcset')
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
    // Reader article images are below the fold and off-origin; defer them so they
    // never block the panel's first paint or burn bandwidth on a quick skim.
    if (node.tagName === 'IMG') {
      node.setAttribute('loading', 'lazy')
      node.setAttribute('decoding', 'async')
    }
  })
}

export function cleanHtml(html: string, baseUrl?: string): string {
  currentBase = baseUrl ?? null
  try {
    return DOMPurify.sanitize(html, SANITIZE_CONFIG)
  } finally {
    currentBase = null
  }
}
