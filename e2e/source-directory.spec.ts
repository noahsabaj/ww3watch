import { test, expect } from '@playwright/test'
import { sourceCatalog } from '../src/lib/data/source-catalog'
import { sourceAudit } from '../src/lib/data/source-audit'

// Picked by what the test needs, not by array position: indexing sourceCatalog
// meant adding any feed that sorts earlier silently re-pointed every fixture.
const reviewed = new Set(sourceAudit.sources.map(s => s.sourceId))
const byId = (id: string) => sourceCatalog.find(c => c.id === id)!
const first = byId(sourceAudit.sources[0].sourceId)
const second = byId(sourceAudit.sources[1].sourceId)
const third = sourceCatalog.find(c => !reviewed.has(c.id))!
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
    await search.fill(second.name)
    await expect(page.locator(`#source-${second.id}`)).toBeVisible()
    const target = page.locator(`#source-${second.id} > summary`)
    await target.focus(); await page.keyboard.press('Enter')
    // Assert the profile's own structure, not a sentence a copy-edit could change.
    await expect(page.locator(`#source-${second.id}`)).toContainText('Publisher / ownership')
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

test('article samples are fetched only when their disclosure is opened', async ({ page }) => {
  const requested: string[] = []
  page.on('request', r => { if (r.url().includes('source-samples.json')) requested.push(r.url()) })
  await page.goto(`/about#source-${first.id}`)
  await expect(page.locator(`#source-${first.id}`)).toContainText('Publisher evidence')
  expect(requested, 'samples must not load just because a profile is open').toHaveLength(0)
  await page.locator(`#source-${first.id}`).getByText(/^Article sample \(/).click()
  await expect(page.locator(`#source-${first.id}`).locator('ol li').first()).toBeVisible()
  expect(requested.length).toBeGreaterThan(0)
})

test('a profile stays readable when the sample evidence fails to load', async ({ page }) => {
  await page.route('**/source-samples.json', r => r.fulfill({ status: 503, body: '{}' }))
  await page.goto(`/about#source-${first.id}`)
  await page.locator(`#source-${first.id}`).getByText(/^Article sample \(/).click()
  // One JSON backs every profile, so the failure flag is shared; assert on the
  // profile the reader actually opened.
  await expect(page.locator(`#source-${first.id}`).getByText('The article samples could not be loaded. The review evidence above is unaffected.')).toBeVisible()
  await expect(page.locator(`#source-${first.id}`)).toContainText('Publisher / ownership')
})

test('reader links use source IDs and Back returns to the selected article', async ({ page }) => {
  await page.goto('/')
  // A story card is not itself the trigger — the headline link inside it is
  // (see smoke.spec.ts). Clicking the <article> does nothing.
  await expect(page.locator('article a[href]').first()).toBeVisible()
  await page.locator('article a[href]').first().click()
  const reader = page.getByLabel('Article reader', { exact: true })
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
