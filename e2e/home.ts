import { expect, type Locator, type Page } from '@playwright/test'

// The home is the story desk at 820px and up, Signal below it
// (src/routes/+page.svelte). These helpers name the same things in both.

export const isDesk = (page: Page) => (page.viewportSize()?.width ?? 1280) >= 820

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

/** Emoji, and the Unicode arrows/symbols iOS may render as colour emoji. The
 *  interface uses SVG icons (src/lib/components/Icon.svelte) instead. */
export async function emojiInChrome(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Emoji_Presentation, not Extended_Pictographic: © and ® in quoted source
    // text are ordinary characters that no platform draws as emoji.
    const re = /\p{Emoji_Presentation}|️|[←-⇿⬀-⯿]/u
    // Publisher headlines and article text are theirs; check our chrome.
    const skip = '[data-desk-story], [data-desk-story-pane] h2, [data-signal-story] a[href], .prose-reader, [data-trending-story]'
    const hits: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || el.closest(skip) || !re.test(n.textContent ?? '')) continue
      hits.push((n.textContent ?? '').trim().slice(0, 60))
    }
    return hits
  })
}

/** A finger drag down from the top of a scrolling list (pull to refresh). */
export async function pullDown(list: Locator, distance: number) {
  await list.evaluate((el, distance) => {
    const at = (y: number) => [new Touch({ identifier: 1, target: el, clientX: 150, clientY: y })]
    const fire = (type: string, y: number) => el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : at(y), changedTouches: at(y) }))
    fire('touchstart', 300)
    for (let y = 300; y <= 300 + distance; y += 20) fire('touchmove', y)
    fire('touchend', 300 + distance)
  }, distance)
}

/** A short pull springs back; a long one refetches the feed and settles. */
export async function expectPullToRefresh(page: Page, list: Locator) {
  let fetched = 0
  page.on('request', (r) => { if (r.url().includes('/rest/v1/articles')) fetched++ })
  await pullDown(list, 60)
  await expect(list).toHaveCSS('transform', 'none')
  expect(fetched).toBe(0)

  const refetch = page.waitForRequest((r) => r.url().includes('/rest/v1/articles'))
  await pullDown(list, 200)
  await refetch
  await expect(list).toHaveAttribute('aria-busy', 'false')
  await expect(list).toHaveCSS('transform', 'none')
  await expect(stories(page).first()).toBeVisible()
}
