// Reading-language preference: which language the reader translates INTO. Set
// once and remembered (localStorage), defaulting from the browser locale so a
// non-English reader gets translations in their language with zero setup.
import { TARGET_LANGS } from './utils'

const STORAGE_KEY = 'reading-lang'

function initialLang(): string {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && TARGET_LANGS.includes(saved)) return saved
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    const code = navigator.language.split('-')[0].toLowerCase()
    if (TARGET_LANGS.includes(code)) return code
  }
  return 'en'
}

// Module-state singleton (same pattern as now.svelte.ts): read prefs.readingLang
// inside reactive expressions; mutate via setReadingLang.
export const prefs = $state({ readingLang: initialLang() })

export function setReadingLang(lang: string): void {
  prefs.readingLang = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // private mode / storage disabled — keep the in-memory preference
  }
}
