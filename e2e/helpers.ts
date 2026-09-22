import { expect, type Page } from '@playwright/test'

/** The list layout is the classic feed the existing tests lock in. */
export async function openList(page: Page) {
  await page.goto('/?view=list')
  await expect(page.locator('article').first()).toBeVisible({ timeout: 20_000 })
}
