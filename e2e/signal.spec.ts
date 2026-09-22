import { test, expect } from '@playwright/test'
import { openHome, openReader, reader, stories, storyCard } from './home'

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

test('tapping a headline opens the reader as a dialog', async ({ page }) => {
  await openReader(page)
  await expect(page.getByRole('dialog', { name: 'Article reader' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(reader(page)).toBeHidden()
  await expect(stories(page).first()).toBeVisible()
})

test('the filter button never covers a story', async ({ page }) => {
  const fab = await page.getByRole('button', { name: /^Open filters/ }).boundingBox()
  const story = storyCard(page)
  for (const el of await story.locator('a[href], button').all()) {
    const box = await el.boundingBox()
    if (!box || !fab) continue
    const overlaps = box.x < fab.x + fab.width && box.x + box.width > fab.x && box.y < fab.y + fab.height && box.y + box.height > fab.y
    expect(overlaps, `${await el.innerText()} sits under the filter button`).toBe(false)
  }
})

test('feed order lives in the filter sheet', async ({ page }) => {
  await page.getByRole('button', { name: /^Open filters/ }).click()
  const order = page.getByRole('dialog').getByRole('group', { name: 'Feed order' })
  await expect(order.getByRole('button', { name: 'Latest' })).toHaveAttribute('aria-pressed', 'true')
  await order.getByRole('button', { name: /^Top/ }).click()
  await expect(order.getByRole('button', { name: /^Top/ })).toHaveAttribute('aria-pressed', 'true')
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
