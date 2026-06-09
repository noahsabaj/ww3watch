// Client-side HTML sanitizer — defense-in-depth before rendering article/translation
// HTML with {@html} in ArticlePanel. The Supabase edge functions already sanitize
// at the source; this guarantees the browser is safe regardless of what any
// endpoint returns. DOMPurify runs against the real browser DOM here.
//
// Shared config with the Deno edge sanitizer (supabase/functions/_shared/sanitize.ts).

import DOMPurify from 'dompurify'

export const SANITIZE_CONFIG = { USE_PROFILES: { html: true } } as const

export function cleanHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}
