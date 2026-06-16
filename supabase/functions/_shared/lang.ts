// Language metadata for the translate function. Kept in sync with the client's
// copy in src/lib/utils.ts (LANG_NAMES) — the server is the authority for what
// targets are accepted, the client only offers a curated subset in the picker.

export const LANG_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', ru: 'Russian',
  ar: 'Arabic', fa: 'Persian', he: 'Hebrew', zh: 'Chinese', tr: 'Turkish',
  uk: 'Ukrainian', hi: 'Hindi', pt: 'Portuguese', ur: 'Urdu', no: 'Norwegian', sv: 'Swedish',
}

// Allowlist the target so a client value is never interpolated raw into the LLM
// prompt (prompt-injection guard) and the cache cardinality stays bounded.
export function isSupportedTarget(code: unknown): code is string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANG_NAMES, code)
}

// Backward-compatible translation cache key parts. English keeps the ORIGINAL
// formula ([sourceLang, title, content]) so the entire existing English cache is
// reused — no re-burning paid quota — while other targets get a distinct
// namespace. Unit-31 (0x1F) delimiter so field boundaries are unambiguous.
export function translationCacheParts(sourceLang: string, target: string, title: string, content: string): string {
  const SEP = String.fromCharCode(31)
  return target === 'en'
    ? [sourceLang, title, content].join(SEP)
    : [sourceLang, target, title, content].join(SEP)
}
