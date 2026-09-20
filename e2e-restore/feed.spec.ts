import { test, expect } from '@playwright/test'
test('restored database renders the feed', async ({page}) => {
  await page.goto('/')
  await expect(page.locator('article').first()).toBeVisible({timeout:30_000})
  expect(await page.locator('article').count()).toBeGreaterThan(10)
  expect((await page.locator('article').first().innerText()).length).toBeGreaterThan(40)
})
