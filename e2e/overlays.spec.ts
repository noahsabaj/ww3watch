import { test, expect, type Page } from '@playwright/test'
import { openHome, openReader, reader, stories } from './home'

// Every surface that opens over the page (menu, phone reader, Theaters page)
// shares one keyboard and focus behaviour: src/lib/modal.ts.

async function focusStaysInside(page: Page, dialog: ReturnType<Page['locator']>) {
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press(i % 5 === 4 ? 'Shift+Tab' : 'Tab')
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  }
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the Theaters page keeps Tab inside and returns focus to the globe on Escape', async ({ page }) => {
    await openHome(page)
    const globe = page.locator('header').getByRole('button', { name: 'Theaters' })
    await globe.focus()
    await page.keyboard.press('Enter')
    const dialog = page.locator('[data-theaters-page]')
    await expect(dialog.getByRole('button', { name: 'Stories' })).toBeFocused()
    await focusStaysInside(page, dialog)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(globe).toBeFocused()
  })

  test('the reader holds the page still while open and lets go when closed', async ({ page }) => {
    await openHome(page)
    await openReader(page)
    const dialog = page.getByRole('dialog', { name: 'Article reader' })
    await expect(dialog.getByRole('button', { name: 'Close reader' })).toBeFocused()
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')
    await focusStaysInside(page, dialog)
    await page.keyboard.press('Escape')
    await expect(reader(page)).toBeHidden()
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
  })

  test('the menu sheet keeps Tab inside and closes on Escape', async ({ page }) => {
    await openHome(page)
    const menu = page.getByRole('button', { name: 'Menu' })
    await menu.click()
    const sheet = page.getByRole('dialog', { name: 'Menu' })
    await expect(sheet).toBeFocused()
    await focusStaysInside(page, sheet)
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(menu).toBeFocused()
  })

  test('the feed still loads when the browser refuses site storage', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError') } })
    })
    await openHome(page)
    expect(await stories(page).count()).toBeGreaterThan(20)
  })
})

test.describe('on the desk', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('with the reader open in the pane, Escape closes the menu first, then the reader', async ({ page }) => {
    await openHome(page)
    await openReader(page)
    await page.getByRole('button', { name: 'Menu' }).click()
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden()
    await expect(reader(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(reader(page)).toBeHidden()
  })
})
