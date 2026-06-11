import { test, expect } from '@playwright/test'

// Locks in the hand-verified QA flows. Runs against live data — assertions
// are structural (counts, states, focus), never about specific headlines.

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('article').first()).toBeVisible({ timeout: 20_000 })
})

test('feed renders a substantial story list from the live backend', async ({ page }) => {
  expect(await page.locator('article').count()).toBeGreaterThan(50)
  await expect(page.locator('header')).toContainText(/\d+ stories/)
})

test('search filters and clears', async ({ page }) => {
  const search = page.locator('header input[type="text"]')
  await search.fill('zzz-no-such-headline-zzz')
  await expect(page.getByText('No articles match your filters.')).toBeVisible()
  await search.fill('')
  await expect(page.locator('article').first()).toBeVisible()
})

test('region filter: None empties the feed, All restores it', async ({ page }) => {
  await page.getByLabel('Filter by region').click()
  const dropdown = page.locator('#region-filter-dropdown')
  await expect(dropdown).toBeVisible()
  await dropdown.getByRole('button', { name: 'None', exact: true }).click()
  await expect(page.getByText('No articles match your filters.')).toBeVisible()
  await dropdown.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.locator('article').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dropdown).toBeHidden()
})

test('reader panel opens as a dialog, focuses close, Escape restores', async ({ page }) => {
  await page.locator('article a[href]').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByLabel('Close reader')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('day separators render at the top of the feed', async ({ page }) => {
  await expect(page.locator('main div', { hasText: /^(Today|Yesterday)$/ }).first()).toBeVisible()
})

test('freshness readout is present and recent-ish', async ({ page }) => {
  await expect(page.locator('header')).toContainText(/updated .* ago|updated just now/)
})
