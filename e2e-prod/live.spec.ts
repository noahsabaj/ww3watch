import { test, expect } from '@playwright/test'

// PRODUCTION CANARY — runs against the deployed site on a schedule, never on a PR.
//
// The PR suite moved to a seeded fixture backend so a red CI always means the
// change broke something. That removed the only automated check that the real
// site still renders: the pipeline's dead-man's switch covers INGESTION, so a
// broken frontend on a healthy backend would have gone unnoticed until someone
// happened to look.
//
// Assertions are deliberately loose. This is asking "is the site alive and is it
// showing recent news", not "is the code correct" — anything tighter would start
// failing for reasons that are not an outage, which is the trap the PR suite was
// just pulled out of.

test('the deployed site serves a live feed', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('article').first()).toBeVisible({ timeout: 30_000 })
  // Loose floor: enough stories that the feed is clearly populated, without
  // pinning a number that varies with the news cycle.
  expect(await page.locator('article').count()).toBeGreaterThan(10)
})

test('ingestion is recent enough that the readout is not stale', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('header')).toBeVisible({ timeout: 30_000 })
  // The header goes amber past 3h and red past 24h. Catch the red tier: hours
  // in double digits, or any "d ago", means several missed runs at minimum.
  await expect(page.locator('header')).toContainText(/updated (just now|[1-5]?\d+m ago)/)
})

test('the reader still opens', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('article').first()).toBeVisible({ timeout: 30_000 })
  await page.locator('article a[href]').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.prose-reader')).toBeVisible({timeout:30_000})
  expect((await page.locator('.prose-reader').innerText()).length).toBeGreaterThan(200)
})

test('Trending Now is on the page with at least one pick', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('article').first()).toBeVisible({ timeout: 30_000 })
  // The section renders only when the pipeline's picks resolve against the
  // loaded feed. It went missing for four weeks when replace_trending started
  // failing: the stale picks pointed outside the feed window, the client
  // resolved nothing, and no check noticed. The pipeline now fails loudly when
  // trending is stuck; this is the user-facing half of that check.
  await expect(page.locator('#trending-list li').first()).toBeVisible()
})
