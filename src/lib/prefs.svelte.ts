// Reading-language preference: which language the reader translates INTO. Set
// once and remembered (localStorage), defaulting from the browser locale so a
// non-English reader gets translations in their language with zero setup.
import { TARGET_LANGS } from './utils'
import { load, save } from './saved'

function initialLang(): string {
  const saved = load('readingLang')
  if (saved && TARGET_LANGS.includes(saved)) return saved
  if (typeof navigator !== 'undefined' && navigator.language) {
    const code = navigator.language.split('-')[0].toLowerCase()
    if (TARGET_LANGS.includes(code)) return code
  }
  return 'en'
}

// Module-state singleton (same pattern as now.svelte.ts): read prefs.readingLang
// inside reactive expressions; mutate via setReadingLang.
export const prefs = $state({ readingLang: initialLang() })

/** Languages a story's headline is preferred in: the reading language, then
 *  English (src/lib/cluster.ts pickRepresentative). Reactive. */
export function leadLangs(): string[] {
  return prefs.readingLang === 'en' ? ['en'] : [prefs.readingLang, 'en']
}

export function setReadingLang(lang: string): void {
  prefs.readingLang = lang
  save('readingLang', lang)
}
