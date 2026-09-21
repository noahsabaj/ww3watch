import { test, expect } from '@playwright/test'
import { sourceCatalog } from '../src/lib/data/source-catalog'

const first = sourceCatalog[0], second = sourceCatalog[1], third = sourceCatalog[2]
test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/sources?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { ...first, enabled: true, last_ok_at: new Date().toISOString(), consecutive_failures: 0 },
    { ...second, enabled: true, last_ok_at: new Date(Date.now()-7200000).toISOString(), consecutive_failures: 0 },
    { ...third, enabled: false, last_ok_at: new Date().toISOString(), consecutive_failures: 0 },
  ]) }))
})

for (const width of [320,390,430]) {
  test(`source profiles are searchable and keyboard accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/about#source-${first.id}`)
    const profile = page.locator(`#source-${first.id}`)
    await expect(profile).toHaveAttribute('open','')
    await expect(profile.locator(':scope > summary')).toBeFocused()
    await expect(profile).toContainText('Publisher evidence')
    await expect(page.getByText('2 enabled · 1 successfully fetched within 60 minutes')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const search = page.getByLabel('Search sources, regions or reviewed ownership')
    await search.fill('Disney')
    await expect(page.getByText('1 matching feeds')).toBeVisible()
    const abc = page.locator(`#source-${second.id} > summary`)
    await abc.focus(); await page.keyboard.press('Enter')
    await expect(page.locator(`#source-${second.id}`)).toContainText('All five sampled international articles were wire reports')
    await search.fill('nothing matches this text')
    await expect(page.getByText('0 matching feeds')).toBeVisible()
    await page.goto(`/about#source-${third.id}`)
    await expect(page.locator(`#source-${third.id}`)).toContainText('Editorial review: pending.')
    await expect(page.locator(`#source-${third.id}`)).toContainText('Fetch status: disabled.')
  })
}

test('source evidence remains readable without live status or JavaScript', async ({ page, request }) => {
  const response = await request.get('/about')
  expect(await response.text()).toContain('972 – Advancement of Citizen Journalism')
  await page.route('**/rest/v1/sources?*',route => route.fulfill({ status: 503, body: '{}' }))
  await page.goto(`/about#source-${first.id}`)
  await expect(page.getByText('Live fetch status is unavailable. Profiles remain readable.')).toBeVisible()
  await expect(page.locator(`#source-${first.id}`)).toContainText('Fetch status: unknown.')
})

test('reader links use source IDs and Back returns to the selected article', async ({ page }) => {
  await page.goto('/')
  // A story card is not itself the trigger — the headline link inside it is
  // (see smoke.spec.ts). Clicking the <article> does nothing.
  await expect(page.locator('article a[href]').first()).toBeVisible()
  await page.locator('article a[href]').first().click()
  const reader = page.getByRole('dialog',{ name: 'Article reader' })
  await expect(reader).toBeVisible()
  const oldUrl = page.url()
  const link = reader.getByRole('link',{ name: 'Source profile' })
  await expect(link).toHaveAttribute('href',/^\/about#(source-[a-f0-9-]+|sources)$/)
  await link.click()
  await expect(page.getByRole('heading',{ name: 'Source directory' })).toBeVisible()
  await page.goBack()
  await expect(reader).toBeVisible()
  expect(page.url()).toBe(oldUrl)
})
