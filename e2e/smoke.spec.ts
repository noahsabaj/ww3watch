import { test, expect } from '@playwright/test'
import { openHome, openReader, reader, selectStory, stories, storyCard } from './home'

// Locks in the hand-verified QA flows, on the story desk (Playwright's Desktop
// Chrome is 1280px wide). Signal, the phone layout, has its own spec.
//
// Runs against the SEEDED fixture backend (supabase/seed.sql), not production.
// It used to assert against live data, which meant a PR went red when the
// ingestion pipeline was having a bad morning — and a red CI that might not be
// your fault is a red CI nobody reads. Numbers below are exact because the data
// is fixed; if one changes, the seed changed or the code broke.
//
// The live site keeps its own watchdog in .github/workflows/prod-smoke.yml.

// 64 seeded articles group into 59 stories: one 4-member story, one 3-member
// story, and 57 singletons.
const STORIES = 59

const multiSource = { hasText: /\d+ outlets/ }
const russian = (page: import('@playwright/test').Page) => ({ has: page.getByText('RU', { exact: true }) })
const wireStory = { hasText: 'Agency copy: ceasefire talks resume' }

test.beforeEach(async ({ page }) => {
  await openHome(page)
})

test('the desk lists every seeded story, grouped, and opens on the top trending one', async ({ page }) => {
  await expect(stories(page)).toHaveCount(STORIES)
  await expect(page.locator('header')).toContainText(`${STORIES} stories`)
  // The seed's trending #1 (rank 0) is the 4-outlet port-strike story, not the newest singleton.
  const top = await page.locator('[data-trending-story]').first().getAttribute('data-trending-story')
  await expect(storyCard(page)).toHaveAttribute('data-story', top!)
  await expect(storyCard(page)).toContainText('How 4 newsrooms put it')
  await expect(page.locator(`[data-desk-story="${top}"]`)).toHaveAttribute('aria-current', 'true')
})

test('picking a story in the rail shows it in the pane', async ({ page }) => {
  const pane = await selectStory(page, multiSource)
  await expect(pane.getByRole('heading', { name: /How \d+ newsrooms put it/ })).toBeVisible()
  const view = pane.getByRole('group', { name: 'Story view' })
  await view.getByRole('button', { name: 'Timeline' }).click()
  await expect(pane.getByText('FIRST', { exact: true })).toBeVisible()
  await view.getByRole('button', { name: 'By side' }).click()
  await expect(pane.getByText('FIRST', { exact: true })).toHaveCount(0)
})

test('j and k move through stories, o reads the one selected', async ({ page }) => {
  await stories(page).first().click()
  const second = await stories(page).nth(1).getAttribute('data-desk-story')
  await page.keyboard.press('j')
  await expect(stories(page).nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(stories(page).nth(1)).toBeFocused()
  await expect(storyCard(page)).toHaveAttribute('data-story', second!)
  await page.keyboard.press('k')
  await expect(stories(page).first()).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('o')
  await expect(reader(page)).toBeVisible()
  await expect(page).toHaveURL(/[?&]article=/)
})

test('search filters and clears', async ({ page }) => {
  const search = page.locator('header input[type="text"]')
  await search.fill('zzz-no-such-headline-zzz')
  await expect(page.getByText('No stories match your filters.')).toBeVisible()
  await search.fill('')
  await expect(stories(page).first()).toBeVisible()
})

test('the empty-state "Clear filters" button restores the feed', async ({ page }) => {
  const search = page.locator('header input[type="text"]')
  await search.fill('zzz-no-such-headline-zzz')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(search).toHaveValue('')
  await expect(stories(page).first()).toBeVisible()
})

test('region filter: None empties the feed, All restores it', async ({ page }) => {
  await page.getByLabel('Filter by region').click()
  const dropdown = page.locator('#region-filter-dropdown')
  await expect(dropdown).toBeVisible()
  await dropdown.getByRole('button', { name: 'None', exact: true }).click()
  await expect(page.getByText('No stories match your filters.')).toBeVisible()
  await dropdown.getByRole('button', { name: 'All', exact: true }).click()
  await expect(stories(page).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dropdown).toBeHidden()
})

test('language filter excludes a language and clearing restores it', async ({ page }) => {
  const before = await stories(page).count()
  await page.getByLabel('Filter by region').click()
  const dropdown = page.locator('#region-filter-dropdown')
  const english = dropdown.getByRole('button', { name: 'English', exact: true })
  await expect(english).toHaveAttribute('aria-pressed', 'true')
  await english.click()
  await expect(english).toHaveAttribute('aria-pressed', 'false')
  // The fixture is roughly half English: excluding it removes stories without
  // emptying the feed.
  await expect.poll(() => stories(page).count()).toBeLessThan(before)
  expect(await stories(page).count()).toBeGreaterThan(0)
  await expect(page.locator('header')).toContainText(/of \d+ stories/)
  await english.click()
  await expect.poll(() => stories(page).count()).toBe(before)
})

test('the reader opens in the pane, focuses close, Escape returns to the story', async ({ page }) => {
  const story = await storyCard(page).getAttribute('data-story')
  await openReader(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByLabel('Close reader')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(reader(page)).toBeHidden()
  await expect(storyCard(page)).toHaveAttribute('data-story', story!)
})

// ── Shallow routing ─────────────────────────────────────────────────────────
// The reader lives in page.state, so the browser's history IS the open/closed
// state: Back closes it, the URL names what you're reading, reload reopens it.

test('opening a story puts it in the URL, and Back closes the reader', async ({ page }) => {
  await openReader(page)
  await expect(page).toHaveURL(/[?&]article=[0-9a-f-]{36}/)

  await page.goBack()
  await expect(reader(page)).toBeHidden()
  await expect(page).not.toHaveURL(/[?&]article=/)
  // Back closed the reader rather than leaving the site.
  await expect(stories(page).first()).toBeVisible()
})

test('reloading with ?article= reopens the same article', async ({ page }) => {
  await openReader(page)
  const deepLink = page.url()
  expect(deepLink).toMatch(/[?&]article=/)

  await page.reload()
  await expect(reader(page)).toBeVisible({ timeout: 20_000 })
  await expect(page).toHaveURL(deepLink)
})

test('closing a COLD deep link stays on the site instead of navigating away', async ({ page }) => {
  // Regression guard for the one case where history.back() is the wrong close:
  // arriving directly at ?article= leaves no entry of ours behind this one.
  await openReader(page)
  const deepLink = page.url()

  await page.goto(deepLink) // fresh load, reader opens from the param
  await expect(reader(page)).toBeVisible({ timeout: 20_000 })

  await page.keyboard.press('Escape')
  await expect(reader(page)).toBeHidden()
  await expect(stories(page).first()).toBeVisible()
  await expect(page).not.toHaveURL(/[?&]article=/)
})

test('switching sources inside the reader does not stack history entries', async ({ page }) => {
  await selectStory(page, multiSource)
  await openReader(page)

  const depthBefore = await page.evaluate(() => history.length)
  const firstUrl = page.url()

  // The timeline's other-source entries are the only dir="auto" buttons in the
  // reader (headlines can be RTL); the close/share/translate controls are not.
  await reader(page).locator('button[dir="auto"]').first().click()
  await expect(page).not.toHaveURL(firstUrl)
  expect(await page.evaluate(() => history.length)).toBe(depthBefore)

  // So ONE Back closes the reader outright rather than walking back through
  // every source the reader happened to look at.
  await page.goBack()
  await expect(reader(page)).toBeHidden()
})

test('picking another story while reading closes the reader onto that story', async ({ page }) => {
  await openReader(page)
  const next = await stories(page).nth(2).getAttribute('data-desk-story')
  await stories(page).nth(2).click()
  await expect(reader(page)).toBeHidden()
  await expect(storyCard(page)).toHaveAttribute('data-story', next!)
  await expect(page).not.toHaveURL(/[?&]article=/)
})

test('reading-language picker stays available when the article matches the reading language', async ({ page }) => {
  // Regression: the picker used to be gated on source_lang !== readingLang, so a
  // reader whose language matched the article lost the picker AND the translate
  // button. Seed Russian, open a Russian-source story, assert the picker is there.
  await page.addInitScript(() => localStorage.setItem('reading-lang', 'ru'))
  await page.reload()
  await expect(stories(page).first()).toBeVisible({ timeout: 20_000 })

  await selectStory(page, russian(page))
  await openReader(page)
  await expect(page.getByLabel('Reading language')).toBeVisible({ timeout: 20_000 })
})

test('day separators head the rail', async ({ page }) => {
  await expect(page.locator('[data-day]', { hasText: /^(Today|Yesterday)$/ }).first()).toBeVisible()
})

test('freshness readout is present and recent-ish', async ({ page }) => {
  await expect(page.locator('header')).toContainText(/updated .* ago|updated just now/)
})

test('wire reprints are marked so the source count is not overstated', async ({ page }) => {
  // The seed's 3-member wire story: two outlets share a body_hash, one is
  // original reporting. The later reprint must be marked.
  const pane = await selectStory(page, wireStory)
  await expect(pane.getByText('wire', { exact: true })).toHaveCount(1)
})

// ── Headline translation ────────────────────────────────────────────────────
// Offered only for a headline that isn't already in the reading language — the
// same gate as the reader. Both directions are asserted so the control can't be
// accidentally always-on or always-off.

test('the pane offers translation only for headlines outside the reading language', async ({ page }) => {
  // Playwright's browser reports en-US, so the reading language defaults to English.
  let pane = await selectStory(page, russian(page))
  await expect(pane.getByRole('button', { name: 'Translate', exact: true })).toBeVisible()
  // The wire story is English on every member — nothing to translate into English.
  pane = await selectStory(page, wireStory)
  await expect(pane.getByRole('button', { name: 'Translate', exact: true })).toHaveCount(0)

  // Flip the reading language: the gate flips with it.
  await page.addInitScript(() => localStorage.setItem('reading-lang', 'ru'))
  await page.reload()
  await expect(stories(page).first()).toBeVisible({ timeout: 20_000 })
  pane = await selectStory(page, russian(page))
  await expect(pane.getByRole('button', { name: 'Translate', exact: true })).toHaveCount(0)
  pane = await selectStory(page, wireStory)
  await expect(pane.getByRole('button', { name: 'Translate', exact: true })).toBeVisible()
})

test('Top ranks the last 24h and always leaves a way back to Latest', async ({ page }) => {
  const order = page.getByRole('group', { name: 'Feed order' })
  const latest = order.getByRole('button', { name: 'Latest' })
  const top = order.getByRole('button', { name: /^Top/ })
  await expect(latest).toHaveAttribute('aria-pressed', 'true')
  await top.click()
  // Whatever the fixture's dates, a way back survives — an empty Top window
  // must never strand the reader.
  await expect(page.getByRole('button', { name: /^(Latest|Show latest)$/ }).first()).toBeVisible()
  await page.getByRole('button', { name: /^(Latest|Show latest)$/ }).first().click()
  await expect(page.getByRole('group', { name: 'Feed order' }).getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-pressed', 'true')
  await expect(stories(page).first()).toBeVisible()
})

// ── Publisher photographs ───────────────────────────────────────────────────

test('a story shows its newsroom photograph, credited to the outlet that published it', async ({ page }) => {
  // The seed's 4-member port-strike story: only the Al Jazeera member has a photo.
  const pane = await selectStory(page, { hasText: /\b4 outlets\b/ })
  await expect(pane).toHaveAttribute('data-photo', '1')
  await expect(pane.locator('img')).toBeVisible()
  await expect(pane.getByText('Photo · Al Jazeera')).toBeVisible()
})

test('a photograph that will not load falls back to the colour field', async ({ page }) => {
  const pane = await selectStory(page, russian(page))
  await expect(pane.locator('img')).toHaveCount(0)
  await expect(pane).not.toHaveAttribute('data-photo', '1')
  await expect(pane.getByText(/^Photo ·/)).toHaveCount(0)
})

test('a story without a photograph stays typographic', async ({ page }) => {
  const pane = await selectStory(page, wireStory)
  await expect(pane.locator('img')).toHaveCount(0)
})

test('the pane photograph is a band above the headline, not behind it', async ({ page }) => {
  const pane = await selectStory(page, { hasText: /\b4 outlets\b/ })
  const img = await pane.locator('img').boundingBox()
  const headline = await pane.locator('h2').boundingBox()
  expect(img!.y + img!.height).toBeLessThanOrEqual(headline!.y)
})
