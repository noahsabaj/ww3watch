// Builds src/lib/server/gazetteer.json, the places a strike story can be
// located at (pipeline/evidence.ts), from GeoNames' cities over 15,000 people
// (CC BY 4.0, credited on /about). Rebuild only to change the country list:
//
//   curl -O https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
//   node --import tsx scripts/build-gazetteer.ts cities15000.txt
//
// Each entry: [geonameid, name, country, lat, lon, population, other Latin-script
// names, names in Cyrillic, Arabic or Hebrew script]. Most strike reports on
// Ukraine come first from Ukrainian outlets, and on Iran, Yemen and Lebanon
// from Persian and Arabic ones, so the other scripts matter (gazetteer.ts
// allows for their case endings and attached prefixes).
import { readFileSync, writeFileSync } from 'node:fs'

// Where the conflicts the site covers are fought, and the NATO states on
// Russia's border (drone incursions, sabotage). China, Japan and the
// Philippines are left out: their fires and quakes are not strike evidence.
const COUNTRIES = new Set(
  ('UA RU BY MD GE AM AZ PL LT LV EE RO ' + // Russia, Ukraine and their neighbours
    'IL PS LB SY IQ IR YE SA AE QA KW BH OM JO EG TR CY ' + // Middle East
    'SD SS LY ET ER SO DJ ML NE BF NG TD CD CF MZ ' + // Africa
    'TW KP KR IN PK AF MM VE CO HT').split(' '),
)
// A Latin-script name as a newsroom would write it: capitalised, 4+ letters,
// not an airport code (HRK) or a lower-case transliteration (samala).
const LATIN_NAME = /^[A-Z][A-Za-z\u00C0-\u024F'\u2019 .-]{3,}$/
// India only where fighting with Pakistan reaches (the northwest, Delhi,
// Kashmir): its other 2,700 cities would add stubble-burning season's fires.
const inScope = (country: string, lat: number, lon: number) => COUNTRIES.has(country) && (country !== 'IN' || (lat > 23 && lon < 77.5))

const src = process.argv[2]
if (!src) throw new Error('usage: build-gazetteer.ts <cities15000.txt>')
// A name wholly in one of those scripts, 3+ letters.
const OTHER_NAME = /^(?:[\p{Script=Cyrillic}][\p{Script=Cyrillic}\p{M} '\u2019-]{2,}|[\p{Script=Arabic}][\p{Script=Arabic}\p{M}\u200C \u2019-]{2,}|[\p{Script=Hebrew}][\p{Script=Hebrew}\p{M} '\u2019"-]{2,})$/u

const places: Array<[number, string, string, number, number, number, string[], string[]]> = []
for (const line of readFileSync(src, 'utf8').split('\n')) {
  const c = line.split('\t')
  if (c.length < 15 || !inScope(c[8], Number(c[4]), Number(c[5]))) continue
  const alternates = c[3].split(',')
  const others = new Set([c[2], ...alternates].filter((n) => n !== c[1] && LATIN_NAME.test(n) && n !== n.toUpperCase()))
  const scripts = new Set(alternates.map((n) => n.trim()).filter((n) => OTHER_NAME.test(n)))
  places.push([Number(c[0]), c[1], c[8], Number(Number(c[4]).toFixed(4)), Number(Number(c[5]).toFixed(4)), Number(c[14]), [...others], [...scripts]])
}
places.sort((a, b) => a[0] - b[0])
writeFileSync(new URL('../src/lib/server/gazetteer.json', import.meta.url), JSON.stringify(places) + '\n')
console.log(`${places.length} places from ${COUNTRIES.size} countries`)
