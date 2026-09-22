import { expect, type Locator, type Page } from '@playwright/test'

// The home is the story desk at 900px and up, Signal below it
// (src/routes/+page.svelte). These helpers name the same things in both.

export const isDesk = (page: Page) => (page.viewportSize()?.width ?? 1280) >= 900

/** Every story in the feed: rail rows on the desk, full-screen stories in Signal. */
export const stories = (page: Page): Locator =>
  isDesk(page) ? page.locator('[data-desk-story]') : page.locator('[data-signal-story]')

/** The story on show: the desk's pane, or Signal's first story. */
export const storyCard = (page: Page): Locator =>
  isDesk(page) ? page.locator('[data-desk-story-pane]') : page.locator('[data-signal-story]').first()

/** The reader: a region of the desk's pane, a dialog over Signal. */
export const reader = (page: Page): Locator => page.getByLabel('Article reader', { exact: true })

export async function openHome(page: Page, path = '/') {
  await page.goto(path)
  await expect(stories(page).first()).toBeVisible({ timeout: 20_000 })
}

/** Desk only: pick the first rail story matching `filter` and wait for the pane to show it. */
export async function selectStory(page: Page, filter: Parameters<Locator['filter']>[0]) {
  const row = page.locator('[data-desk-story]').filter(filter).first()
  await row.click()
  const id = await row.getAttribute('data-desk-story')
  await expect(storyCard(page)).toHaveAttribute('data-story', id!)
  return storyCard(page)
}

/** Open the reader on the story on show, through its headline. */
export async function openReader(page: Page) {
  await storyCard(page).locator('a[href]').first().click()
  await expect(reader(page)).toBeVisible()
}
