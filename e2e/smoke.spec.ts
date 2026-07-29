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
  await expect(page.getByText('No stories match your filters.')).toBeVisible()
  await search.fill('')
  await expect(page.locator('article').first()).toBeVisible()
})

test('the empty-state "Clear filters" button restores the feed', async ({ page }) => {
  const search = page.locator('header input[type="text"]')
  await search.fill('zzz-no-such-headline-zzz')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('article').first()).toBeVisible()
})

test('region filter: None empties the feed, All restores it', async ({ page }) => {
  await page.getByLabel('Filter by region').click()
  const dropdown = page.locator('#region-filter-dropdown')
  await expect(dropdown).toBeVisible()
  await dropdown.getByRole('button', { name: 'None', exact: true }).click()
  await expect(page.getByText('No stories match your filters.')).toBeVisible()
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

// ── Shallow routing ─────────────────────────────────────────────────────────
// The panel lives in page.state, so the browser's history IS the open/closed
// state. Before this, opening an article was invisible to history: Back left
// the site instead of closing the reader, and the URL never named what you were
// reading (which is why a separate Share button had to reconstruct the link).

test('opening a story puts it in the URL, and Back closes the panel', async ({ page }) => {
  await page.locator('article a[href]').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).toHaveURL(/[?&]article=[0-9a-f-]{36}/)

  await page.goBack()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page).not.toHaveURL(/[?&]article=/)
  // Back closed the reader rather than leaving the site — the feed is still here,
  // and was never re-fetched.
  await expect(page.locator('article').first()).toBeVisible()
})

test('reloading with ?article= reopens the same article', async ({ page }) => {
  await page.locator('article a[href]').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const deepLink = page.url()
  expect(deepLink).toMatch(/[?&]article=/)

  await page.reload()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(deepLink)
})

test('closing a COLD deep link stays on the site instead of navigating away', async ({ page }) => {
  // Regression guard for the one case where history.back() is the wrong close:
  // arriving directly at ?article= leaves no entry of ours behind this one.
  await page.locator('article a[href]').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  const deepLink = page.url()

  await page.goto(deepLink) // fresh load, panel opens from the param
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 })

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('article').first()).toBeVisible()
  await expect(page).not.toHaveURL(/[?&]article=/)
})

test('switching sources inside the panel does not stack history entries', async ({ page }) => {
  // Open a multi-source story so the in-panel timeline offers another source.
  await page.locator('article', { has: page.getByRole('button', { name: /sources covered this/ }) })
    .first().locator('a[href]').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const depthBefore = await page.evaluate(() => history.length)
  const firstUrl = page.url()

  // The timeline's other-source entries are the only dir="auto" buttons in the
  // panel (headlines can be RTL); the close/share/translate controls are not.
  await dialog.locator('button[dir="auto"]').first().click()
  await expect(page).not.toHaveURL(firstUrl)
  expect(await page.evaluate(() => history.length)).toBe(depthBefore)

  // So ONE Back closes the reader outright rather than walking back through
  // every source the reader happened to look at.
  await page.goBack()
  await expect(dialog).toBeHidden()
})

test('reading-language picker stays available when the article matches the reading language', async ({ page }) => {
  // Regression: the picker used to be gated on source_lang !== readingLang, so a
  // reader whose language matched the article (a Russian reader on a Russian
  // article) lost the picker AND the translate button — stranded. Seed Russian,
  // open a Russian-source story, and assert the picker is still there.
  await page.addInitScript(() => localStorage.setItem('reading-lang', 'ru'))
  await page.reload()
  await expect(page.locator('article').first()).toBeVisible({ timeout: 20_000 })

  // Prefer a card whose representative carries the "RU" language chip (source==target,
  // the exact regression case); fall back to the first story if none is on screen.
  const ruCard = page.locator('article').filter({ has: page.getByText('RU', { exact: true }) }).first()
  const headline = (await ruCard.count())
    ? ruCard.locator('a[href]').first()
    : page.locator('article a[href]').first()
  await headline.click()

  await expect(page.getByRole('dialog')).toBeVisible()
  // The picker renders once the reader settles (loaded or failed) — it must appear
  // regardless of whether the article is in the reading language.
  await expect(page.getByLabel('Reading language')).toBeVisible({ timeout: 20_000 })
})

test('day separators render at the top of the feed', async ({ page }) => {
  await expect(page.locator('main div', { hasText: /^(Today|Yesterday)$/ }).first()).toBeVisible()
})

test('freshness readout is present and recent-ish', async ({ page }) => {
  await expect(page.locator('header')).toContainText(/updated .* ago|updated just now/)
})
