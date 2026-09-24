import { test, expect } from '@playwright/test'
import { expectPullToRefresh, openHome, openReader, reader, stories, storyCard } from './home'

// Below 900px the home is Signal: one story at a time, full screen.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await openHome(page)
})

test('a phone gets Signal, not the desk', async ({ page }) => {
  await expect(storyCard(page)).toBeVisible()
  await expect(page.locator('[data-desk-rail]')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('the feed leads with the story most outlets covered, not the newest lone report', async ({ page }) => {
  // Seed: four outlets carried the port strike two hours ago; single-outlet
  // reports are as new as 12 minutes.
  await expect(stories(page).first()).toContainText('Strike reported on northern port facility')
  await expect(stories(page).first()).toContainText('4 sources')
})

test('tapping a headline opens the reader as a dialog', async ({ page }) => {
  await openReader(page)
  await expect(page.getByRole('dialog', { name: 'Article reader' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(reader(page)).toBeHidden()
  await expect(stories(page).first()).toBeVisible()
})

test('search and the menu live in the header, with nothing floating over stories', async ({ page }) => {
  const header = page.locator('header')
  await expect(header.getByRole('button', { name: 'Search headlines' })).toBeVisible()
  await expect(header.getByRole('button', { name: 'Menu' })).toBeVisible()
  const floating = await page.evaluate(() =>
    [...document.querySelectorAll('button, a')].filter((el) => getComputedStyle(el).position === 'fixed').length)
  expect(floating).toBe(0)
})

test('the search button opens a field; Cancel clears it and restores the feed', async ({ page }) => {
  await page.getByRole('button', { name: 'Search headlines' }).click()
  const field = page.getByRole('searchbox', { name: 'Search headlines' })
  await field.fill('zzz-no-such-headline-zzz')
  await expect(page.getByText('No stories match “zzz-no-such-headline-zzz”.')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(field).toBeHidden()
  await expect(storyCard(page)).toBeVisible()
})

test('the read tip shows until a covered story is opened, then stays gone', async ({ page }) => {
  const tip = page.locator('[data-read-tip]')
  const covered = stories(page).filter({ has: tip }).first()
  await expect(covered).toContainText('Tap the headline to read it and every other newsroom')
  await covered.locator('a.font-serif').click()
  await expect(reader(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(reader(page)).toBeHidden()
  await expect(tip).toHaveCount(0)
  await page.reload()
  await expect(storyCard(page)).toBeVisible()
  await expect(tip).toHaveCount(0)
})

test('Signal carries no position counter or visible scrollbar', async ({ page }) => {
  await expect(page.getByText(/^\d+ \/ \d+$/)).toHaveCount(0)
  const scroller = page.getByLabel('Stories', { exact: true })
  expect(await scroller.evaluate((el) => el.offsetWidth - el.clientWidth)).toBe(0)
})

test('a first visit shows a swipe cue on the first story until the reader swipes', async ({ page }) => {
  const hint = page.locator('[data-swipe-hint]')
  await expect(hint).toHaveCount(1)
  await expect(stories(page).first().locator('[data-swipe-hint]')).toContainText('Swipe up for the next story')
  await page.getByLabel('Stories', { exact: true }).evaluate((el) => el.scrollBy(0, el.clientHeight))
  await expect(hint).toHaveCount(0)
  await page.reload()
  await expect(storyCard(page)).toBeVisible()
  await expect(hint).toHaveCount(0)
})

test('the address follows the story on screen, so a browser share sends it', async ({ page }) => {
  expect(new URL(page.url()).search).toBe('')
  await page.getByLabel('Stories', { exact: true }).evaluate((el) => el.scrollBy(0, el.clientHeight))
  await expect(page).toHaveURL(/\/\?(story|article)=[\w-]+$/)
  const onScreen = page.url()
  await stories(page).nth(1).locator('a[href]').first().click()
  await expect(reader(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(onScreen)
})

test('reopening the app shows the stories it already had, without waiting on the network', async ({ page }) => {
  await expect(storyCard(page)).toBeVisible()
  // The page saves its copy when it is put away; a reload does that too.
  await page.route('**/rest/v1/articles?*', async (route) => {
    await new Promise((r) => setTimeout(r, 5000))
    await route.continue()
  })
  await page.reload()
  await expect(storyCard(page)).toBeVisible({ timeout: 2000 })
})

test('pulling the first story down refreshes the feed', async ({ page }) => {
  await expectPullToRefresh(page, page.getByLabel('Stories', { exact: true }))
})

test.describe('iPad', () => {
  test.use({ viewport: { width: 834, height: 1194 }, hasTouch: true })
  test('pulling the story list down refreshes the feed', async ({ page }) => {
    await expectPullToRefresh(page, page.locator('[data-desk-rail]'))
  })
})

test.describe('iPhone home-screen app', () => {
  // iOS reports the standalone app's viewport one status bar (62px here) short
  // of the screen it draws on; the frame must reach the real bottom anyway.
  test.use({ viewport: { width: 440, height: 894 } })
  test('the feed reaches the bottom of the screen, not of the short viewport', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { value: true })
      Object.defineProperty(screen, 'width', { value: 440 })
      Object.defineProperty(screen, 'height', { value: 956 })
    })
    await page.reload()
    await expect(storyCard(page)).toBeVisible()
    await expect.poll(() => page.locator('[data-app-frame]').evaluate((el) => el.getBoundingClientRect().height)).toBe(956)
  })
  test('in the browser the frame keeps to the viewport', async ({ page }) => {
    expect(await page.locator('[data-app-frame]').evaluate((el) => el.getBoundingClientRect().height)).toBe(894)
  })
})

test('the story scroller is keyboard reachable', async ({ page }) => {
  const scroller = page.getByLabel('Stories', { exact: true })
  await scroller.focus()
  await expect(scroller).toBeFocused()
})

test('Signal carries the newsroom photograph and its credit, and falls back without one', async ({ page }) => {
  const withPhoto = page.locator('[data-signal-story]').filter({ hasText: /\b4 sources\b/ })
  await expect(withPhoto).toHaveAttribute('data-photo', '1')
  await expect(withPhoto.getByText('Photo · Al Jazeera')).toBeAttached()
  const broken = page.locator('[data-signal-story]').filter({ has: page.getByText('RU', { exact: true }) }).first()
  await broken.scrollIntoViewIfNeeded()
  await expect(broken.locator('img')).toHaveCount(0)
})

test('a strike story says what satellites saw there, linked to the reading', async ({ page }) => {
  const line = stories(page).first().locator('[data-story-evidence] a')
  await expect(line).toHaveText('NASA satellites saw a new fire 8 km from Odesa, 30 min after the first report')
  await expect(line).toHaveAttribute('href', 'https://firms.modaps.eosdis.nasa.gov/map/')
  await expect(stories(page).nth(1).locator('[data-story-evidence]')).toHaveCount(0)
})

test('a story covered from both sides shows the other side first, labelled, and tags a contradiction', async ({ page }) => {
  const story = page.locator('[data-signal-story]', { hasText: 'Air defences downed all drones over the border region' })
  await story.scrollIntoViewIfNeeded()
  await expect(story.locator('li').first()).toContainText('Українська правда')
  await expect(story.locator('[data-side]')).toHaveText('(Ukrainian media)')
  await expect(story.getByRole('button', { name: 'disputed', exact: true })).toBeVisible()
  // A story no side contradicts carries no tag.
  await expect(stories(page).first().getByRole('button', { name: 'disputed', exact: true })).toHaveCount(0)
})

test('the menu offers alerts, off until the reader turns them on', async ({ page }) => {
  // The test browser answers "denied" for notifications without asking; a
  // real one has not been asked yet.
  await page.addInitScript(() => { Object.defineProperty(Notification, 'permission', { get: () => 'default' }) })
  await page.reload()
  await page.locator('header').getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('switch', { name: 'Alerts' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.locator('[data-alerts]')).toContainText('only when something world-changing happens')
})

test.describe('in Safari on an iPhone', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
  test('alerts point to the Home Screen app, the only place iOS allows them', async ({ page }) => {
    // Safari outside the Home Screen app has no Push API.
    await page.addInitScript(() => { delete (window as { PushManager?: unknown }).PushManager })
    await page.reload()
    await page.locator('header').getByRole('button', { name: 'Menu' }).click()
    await expect(page.locator('[data-alerts]')).toContainText('Add WW3Watch to your Home Screen')
    await expect(page.getByRole('switch', { name: 'Alerts' })).toHaveCount(0)
  })
})

test('a story without a photograph sits in the middle of the screen, its summary under the headline', async ({ page }) => {
  const story = page.locator('[data-signal-story]:not([data-photo])').filter({ has: page.locator('[data-story-summary]') }).first()
  await story.scrollIntoViewIfNeeded()
  // The space above the story and below it (the two flex-1 spacers are the
  // space, not the story).
  const { above, below } = await story.evaluate((el) => {
    const frame = el.getBoundingClientRect()
    const parts = [...el.lastElementChild!.children]
      .filter((k) => !k.matches('.flex-1, [data-swipe-hint]'))
      .map((k) => k.getBoundingClientRect())
      .filter((r) => r.height > 0)
    return { above: Math.min(...parts.map((r) => r.top)) - frame.top, below: frame.bottom - Math.max(...parts.map((r) => r.bottom)) }
  })
  // Not pinned to the top with the bottom half empty (#160), nor to the bottom.
  expect(above).toBeGreaterThan(60)
  expect(Math.abs(above - below)).toBeLessThan(40)
  const headline = await story.locator('a[href]').first().boundingBox()
  const summary = await story.locator('[data-story-summary]').boundingBox()
  expect(summary!.y).toBeGreaterThan(headline!.y + headline!.height - 1)
})

// Every iPad but the mini gets the desk: an 11" iPad in portrait is 820-834px
// wide; a 13" is 1032px portrait and 1376px landscape.
for (const [width, height, layout] of [[744, 1133, 'signal'], [820, 1180, 'desk'], [834, 1194, 'desk'], [1032, 1376, 'desk']] as const) {
  test.describe(`${width}px tablet`, () => {
    test.use({ viewport: { width, height }, hasTouch: true })
    test(`gets ${layout === 'desk' ? 'the story desk' : 'Signal'}`, async ({ page }) => {
      await expect(page.locator(layout === 'desk' ? '[data-desk-rail]' : '[data-signal-story]').first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  })
}

test('a photograph never sits under the story text', async ({ page }) => {
  const story = page.locator('[data-signal-story][data-photo="1"]').first()
  await story.scrollIntoViewIfNeeded()
  const img = await story.locator('img').boundingBox()
  const headline = await story.locator('a[href]').first().boundingBox()
  expect(img && headline).toBeTruthy()
  expect(img!.y + img!.height).toBeLessThanOrEqual(headline!.y)
})
