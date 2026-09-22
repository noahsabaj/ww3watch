import { test, expect } from '@playwright/test'

test('Signal is the first-open homepage', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Signal', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-signal-story]').first()).toBeVisible({ timeout: 20_000 })
})

test('tapping a Signal headline opens the reader', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-signal-story] a[href]').first()).toBeVisible({ timeout: 20_000 })
  await page.locator('[data-signal-story] a[href]').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.locator('[data-signal-story]').first()).toBeVisible()
})

test('List restores the classic feed and Signal takes it back', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-signal-story]').first()).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('group', { name: 'Feed order' })).toBeVisible()
  await expect(page.locator('article').first()).toBeVisible()
  await page.getByRole('button', { name: 'Signal', exact: true }).click()
  await expect(page.locator('[data-signal-story]').first()).toBeVisible()
})

test('Signal falls back to the colour field when a story has no photograph', async ({ page }) => {
  await page.goto('/')
  const story = page.locator('[data-signal-story]').first()
  await expect(story).toBeVisible({ timeout: 20_000 })
  await expect(story).not.toHaveAttribute('data-photo', '1')
  await expect(story.locator('img')).toHaveCount(0)
})
