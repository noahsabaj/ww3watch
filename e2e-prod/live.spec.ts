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

// Desktop Chrome gets the story desk (src/lib/components/StoryDesk.svelte):
// stories are rows in the left rail, the selected one shows in the pane, and
// the reader opens in that pane. A phone gets Signal, checked separately.
const rows = '[data-desk-story]'

test('the deployed site serves a live feed', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator(rows).first()).toBeVisible({ timeout: 30_000 })
  // Loose floor: enough stories that the feed is clearly populated, without
  // pinning a number that varies with the news cycle.
  expect(await page.locator(rows).count()).toBeGreaterThan(10)
})

test('a phone gets the one-story-at-a-time feed', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const page = await context.newPage()
  await page.goto(test.info().project.use.baseURL!)
  await expect(page.locator('[data-signal-story]').first()).toBeVisible({ timeout: 30_000 })
  expect(await page.locator('[data-signal-story]').count()).toBeGreaterThan(10)
  await context.close()
})

test('ingestion is recent enough that the readout is not stale', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('header')).toBeVisible({ timeout: 30_000 })
  // The operational threshold is one hour, including the browser readout.
  await expect(page.locator('header')).toContainText(/updated (just now|[1-5]?\dm ago)/)
})

test('the reader still opens', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('./')
  await expect(page.locator(rows).first()).toBeVisible({ timeout: 30_000 })
  // A publisher can block extraction while our reader is healthy. Exercise a
  // small sample of independent hosts; an explicit original-link fallback is
  // acceptable per article, but the canary still requires real rendered text.
  const pane = page.locator('[data-desk-story-pane]')
  const reader = page.getByLabel('Article reader', { exact: true })
  const hosts = new Set<string>()
  const total = Math.min(await page.locator(rows).count(), 40)
  let rendered = false
  for (let i = 0; i < total && hosts.size < 8 && !rendered; i++) {
    const row = page.locator(rows).nth(i)
    await row.click()
    await expect(pane).toHaveAttribute('data-story', (await row.getAttribute('data-desk-story'))!)
    const headline = pane.locator('a[href]').first()
    // Keep the literal attribute: .href percent-encodes Persian/Arabic paths,
    // which no longer match the reader's original link.
    const href = (await headline.getAttribute('href'))!
    const host = new URL(href).hostname
    if (hosts.has(host)) continue
    hosts.add(host)
    await headline.click()
    await expect(reader).toBeVisible()
    await expect(reader.getByRole('link', { name: 'Read original', exact: true })).toHaveAttribute('href', href)
    const content = reader.locator('.prose-reader')
    const fallback = reader.getByRole('link', { name: 'Full article unavailable — read original', exact: true })
    await expect(content.or(fallback)).toBeVisible({ timeout: 15_000 })
    if (await content.isVisible() && (await content.innerText()).length > 200) rendered = true
    else await expect(fallback).toHaveAttribute('href', href)
    await reader.getByRole('button', { name: 'Close reader', exact: true }).click()
  }
  expect(rendered, 'At least one sampled publisher must render full reader content').toBe(true)
})

test('Trending Now is on the page with at least one pick', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator(rows).first()).toBeVisible({ timeout: 30_000 })
  // The section renders only when the pipeline's picks resolve against the
  // loaded feed. It went missing for four weeks when replace_trending started
  // failing: the stale picks pointed outside the feed window, the client
  // resolved nothing, and no check noticed. The pipeline now fails loudly when
  // trending is stuck; this is the user-facing half of that check.
  await expect(page.locator('[data-trending-story]').first()).toBeVisible()
})
