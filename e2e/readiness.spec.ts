import { test, expect } from '@playwright/test'

test('public pages have unique initial HTML metadata', async ({ request }) => {
  for (const path of ['/', '/about', '/trends', '/privacy', '/feedback']) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html.match(/<title>/g)).toHaveLength(1)
    expect(html.match(/rel="canonical"/g)).toHaveLength(1)
    expect(html).toContain(`https://ww3watch.org${path}`)
    expect(html).toContain('application/ld+json')
  }
})

for (const width of [320, 390, 430]) {
  test(`phone navigation and filters fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await expect(page.locator('article').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByText('Menu', { exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Site navigation' })).toBeVisible()
    await page.getByText('Menu', { exact: true }).click()
    await page.getByRole('button', { name: 'Open filters' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByLabel('Search headlines', { exact: true })).toBeVisible()
    await page.keyboard.press('Shift+Tab')
    expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true)
    await sheet.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(sheet).toBeHidden()
    await expect(page.getByRole('button', { name: 'Open filters' })).toBeFocused()
  })
}
