import { describe, it, expect } from 'vitest'
import { placesIn, placeLabel, fold, wordKeys } from './gazetteer'

const labels = (text: string) => placesIn(text).map(placeLabel)

describe('placesIn', () => {
  it('finds a place in an English headline, possessive and all', () => {
    expect(labels('Kyiv under Russian missile attack, two dead, mayor says')).toContain('Kyiv, Ukraine')
    expect(labels("Blast rocks Kyiv's outskirts")).toContain('Kyiv, Ukraine')
    expect(labels('Blast rocks military site in Syria’s Deir ez-Zor, kills 11')).toContain('Deir ez-Zor, Syria')
  })

  it('names a place without diacritics, as newsrooms do', () => {
    expect(labels('Pakistan strikes Kandahar')).toEqual(['Kandahar, Afghanistan'])
  })

  it('needs the capital letter a place name has', () => {
    expect(labels('A van exploded near the market')).toEqual([])
  })

  it('reads Ukrainian and Russian names with their case endings', () => {
    expect(labels('Ворог атакував Одесу, пошкоджені медичний заклад')).toContain('Odesa, Ukraine')
    expect(labels('У Києві через російські атаки постраждали 43 людей')).toContain('Kyiv, Ukraine')
    expect(labels('Удары по логистическим центрам в Одессе')).toContain('Odesa, Ukraine')
    expect(labels('Росіяни вдарили по Харкову')).toContain('Kharkiv, Ukraine')
  })

  it('reads Arabic and Persian names with attached words and split halves', () => {
    expect(labels('الغارات الإسرائيلية على بيروت والضاحية')).toContain('Beirut, Lebanon')
    expect(labels('وقوع انفجارهای شدید در اربیل')).toContain('Erbil, Iraq')
    expect(labels('حملات سنگین روسیه به کی یف')).toContain('Kyiv, Ukraine')
  })

  it('ranks the most populous first and caps the list', () => {
    const found = placesIn('Strikes on Kyiv, Odesa, Kharkiv, Dnipro, Lviv, Sumy, Kherson, Mykolaiv and Poltava', 3)
    expect(found).toHaveLength(3)
    expect(found[0].name).toBe('Kyiv')
  })
})

describe('fold and wordKeys', () => {
  it('folds the letters Persian and Arabic write differently', () => {
    expect(fold('كييف')).toBe(fold('کییف'))
    expect(fold('کی\u200Cیف')).toBe('کییف')
  })

  it('offers a word without its Arabic prefixes, Hebrew prefix, or Russian ending', () => {
    expect(wordKeys(fold('وبالموصل'))).toContain(fold('موصل'))
    expect(wordKeys('בקייב')).toContain('קייב')
    expect(wordKeys('одессе')).toContain('одесс')
  })
})
