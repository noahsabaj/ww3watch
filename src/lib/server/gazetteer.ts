// Place names a story's reports can be located by (pipeline/evidence.ts):
// GeoNames cities over 15,000 people in the countries the site covers
// (gazetteer.json, built by scripts/build-gazetteer.ts; CC BY 4.0).
import { readFileSync } from 'node:fs'

export interface Place {
  id: number
  name: string
  country: string
  lat: number
  lon: number
  population: number
}

type Row = [number, string, string, number, number, number, string[], string[]]

export const COUNTRY_NAMES: Record<string, string> = {
  UA: 'Ukraine', RU: 'Russia', BY: 'Belarus', MD: 'Moldova', GE: 'Georgia', AM: 'Armenia', AZ: 'Azerbaijan',
  PL: 'Poland', LT: 'Lithuania', LV: 'Latvia', EE: 'Estonia', RO: 'Romania',
  IL: 'Israel', PS: 'Palestine', LB: 'Lebanon', SY: 'Syria', IQ: 'Iraq', IR: 'Iran', YE: 'Yemen',
  SA: 'Saudi Arabia', AE: 'the UAE', QA: 'Qatar', KW: 'Kuwait', BH: 'Bahrain', OM: 'Oman', JO: 'Jordan',
  EG: 'Egypt', TR: 'Türkiye', CY: 'Cyprus',
  SD: 'Sudan', SS: 'South Sudan', LY: 'Libya', ET: 'Ethiopia', ER: 'Eritrea', SO: 'Somalia', DJ: 'Djibouti',
  ML: 'Mali', NE: 'Niger', BF: 'Burkina Faso', NG: 'Nigeria', TD: 'Chad', CD: 'DR Congo', CF: 'Central African Republic', MZ: 'Mozambique',
  TW: 'Taiwan', KP: 'North Korea', KR: 'South Korea', IN: 'India', PK: 'Pakistan', AF: 'Afghanistan', MM: 'Myanmar',
  VE: 'Venezuela', CO: 'Colombia', HT: 'Haiti',
}

// Cyrillic, Arabic-script and Hebrew names are compared folded: lower case,
// no vowel marks or tatweel, one form of the letters Persian and Arabic write
// differently (ي/ی, ك/ک, the alefs), and no zero-width joiners (کی‌یف).
export function fold(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640\u200C\u200D\u05B0-\u05C7]/g, '')
    .replace(/[يىئ]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ё/g, 'е')
}

const CYRILLIC = /^\p{Script=Cyrillic}/u
const ARABIC = /^\p{Script=Arabic}/u
const HEBREW = /^\p{Script=Hebrew}/u

/** A Russian or Ukrainian name without its final vowel or soft sign: Одесса → одесс,
 *  which "в Одессе", "по Одессе" and "Одессу" all begin with. */
const stem = (folded: string): string => (folded.length >= 5 ? folded.replace(/[аяоеьыийуюіїє]$/, '') : folded)

/** The keys a folded word might be filed under: itself; without an Arabic
 *  conjunction or preposition and article (وبالموصل → موصل); without a Hebrew
 *  prefix (בקייב → קייב); or cut back to a Russian or Ukrainian stem. */
export function wordKeys(word: string): string[] {
  const keys = [word]
  if (ARABIC.test(word)) {
    const bare = word.replace(/^[وف]?[بلک]?(?:ال)?/, '')
    if (bare !== word && bare.length >= 3) keys.push(bare)
    if (word.startsWith('ال') && word.length >= 5) keys.push(word.slice(2))
  } else if (HEBREW.test(word)) {
    for (let k = 1; k <= 2 && word.length - k >= 3; k++) if (/^[בלמהושכ]+$/.test(word.slice(0, k))) keys.push(word.slice(k))
  } else if (CYRILLIC.test(word)) {
    for (let k = 1; k <= 3 && word.length - k >= 3; k++) keys.push(word.slice(0, -k))
  }
  return keys
}

let latin: Map<string, Place[]> | null = null
let folded: Map<string, Place[]> = new Map()
let byId: Map<number, Place> = new Map()

function file(index: Map<string, Place[]>, key: string, place: Place) {
  const list = index.get(key)
  if (!list) index.set(key, [place])
  else if (!list.includes(place)) list.push(place)
}

function load(): Map<string, Place[]> {
  const rows = JSON.parse(readFileSync(new URL('./gazetteer.json', import.meta.url), 'utf8')) as Row[]
  const byName = new Map<string, Place[]>()
  folded = new Map()
  byId = new Map()
  for (const [id, name, country, lat, lon, population, others, scripts] of rows) {
    // Shown as English newsrooms write it: Kandahar, not GeoNames' Kandahār.
    const place = { id, name: name.normalize('NFD').replace(/\p{M}/gu, ''), country, lat, lon, population }
    byId.set(id, place)
    for (const n of [name, ...others]) file(byName, n.normalize('NFC'), place)
    for (const n of scripts ?? []) {
      const f = fold(n)
      file(folded, f, place)
      if (ARABIC.test(f) && f.startsWith('ال') && f.length >= 5) file(folded, f.slice(2), place)
      if (CYRILLIC.test(f) && !f.includes(' ')) {
        file(folded, stem(f), place)
        // Ukrainian і/ї turns into о/е/є when the word takes an ending:
        // Харків → у Харкові, Київ → до Києва.
        const m = /^(.+)[ії]([^аяоеьыийуюіїє])$/.exec(f)
        if (m) for (const v of ['о', 'е', 'є']) file(folded, m[1] + v + m[2], place)
      }
    }
  }
  return byName
}

export function placeById(id: number): Place | undefined {
  latin ??= load()
  return byId.get(id)
}

const MAX_WORDS = 4 // "Khan Yunis", "Deir ez-Zor", "Кривий Ріг"
const EDGES = /^[^\p{L}]+|[^\p{L}]+$/gu

/**
 * Places named in `text`, most populous first. A Latin-script name must match
 * as written, case and all ("Van" the city, not "van" the vehicle); a possessive
 * ("Kyiv's") still counts. Other scripts match folded, allowing for case
 * endings and attached prefixes. Whole words only.
 */
export function placesIn(text: string, limit = 8): Place[] {
  latin ??= load()
  const words = text
    .normalize('NFC')
    .replace(/\u2019/g, "'")
    .split(/[\s,.;:!?()«»"“”/|]+/)
    .map((w) => w.replace(EDGES, '').replace(/'s$/, ''))
    .filter(Boolean)
  const found = new Map<number, Place>()
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= MAX_WORDS && i + n <= words.length; n++) {
      const phrase = words.slice(i, i + n)
      for (const p of latin.get(phrase.join(' ')) ?? []) found.set(p.id, p)
      if (/^\p{Script=Latin}/u.test(phrase[0])) continue
      const f = phrase.map(fold)
      // Persian often writes a name's halves apart: "کی یف" for کی‌یف (Kyiv).
      const keys = n === 1 ? wordKeys(f[0]) : n === 2 && ARABIC.test(f[0]) ? [f.join(' '), f.join('')] : [f.join(' ')]
      for (const k of keys) for (const p of folded.get(k) ?? []) found.set(p.id, p)
    }
  }
  return [...found.values()].sort((a, b) => b.population - a.population).slice(0, limit)
}

export const placeLabel = (p: Pick<Place, 'name' | 'country'>): string => `${p.name}, ${COUNTRY_NAMES[p.country] ?? p.country}`
