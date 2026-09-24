import { test, expect } from '@playwright/test'
import { openHome, stories } from './home'

// Theaters (src/lib/theaters.ts): where a story is happening, from the actors
// Jev tags. The fixture places the port strike, the RT single and the both-sides
// story in Ukraine,
// the corridor talks in Israel & Gaza, and 18 filler stories on the Korean
// Peninsula (supabase/seed.sql).
const bar = (page: import('@playwright/test').Page) => page.locator('[data-theater-bar]')
const onScreen = (page: import('@playwright/test').Page) =>
  page.getByLabel('Stories', { exact: true }).evaluate((el) => {
    const i = Math.round(el.scrollTop / el.clientHeight)
    return el.querySelectorAll<HTMLElement>('[data-signal-story]')[i]?.dataset.story ?? null
  })

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the Theaters page lists places busiest first and opens one', async ({ page }) => {
    await openHome(page)
    await page.locator('header').getByRole('button', { name: 'Theaters' }).click()
    const theaters = page.getByRole('dialog', { name: 'Where it’s happening' })
    await expect(theaters).toBeVisible()
    await expect(theaters.locator('[data-theater]')).toHaveText([/Korean Peninsula/, /Ukraine/, /Israel & Gaza/])
    await theaters.locator('[data-theater="ukraine"]').click()
    await expect(theaters).toBeHidden()
    await expect(bar(page)).toContainText('Ukraine')
    await expect(bar(page)).toContainText('3 stories')
    await expect(stories(page)).toHaveCount(3)
    await expect(page.locator('[data-signal-story] [data-theater-tag]')).toHaveText(['Ukraine', 'Ukraine', 'Ukraine'])
    await bar(page).getByRole('button', { name: 'All stories' }).click()
    await expect(bar(page)).toBeHidden()
    expect(await stories(page).count()).toBeGreaterThan(20)
  })

  test('tapping a story’s place narrows to it and stays on that story, and back out again', async ({ page }) => {
    await openHome(page)
    const strike = page.locator('[data-signal-story]', { hasText: 'Strike reported on northern port facility' })
    await strike.scrollIntoViewIfNeeded()
    const id = await strike.getAttribute('data-story')
    await strike.getByRole('button', { name: 'Show only Ukraine stories' }).click()
    await expect(bar(page)).toContainText('Ukraine')
    await expect.poll(() => onScreen(page)).toBe(id)
    await bar(page).getByRole('button', { name: 'Stop showing only Ukraine' }).click()
    await expect(bar(page)).toBeHidden()
    await expect.poll(() => onScreen(page)).toBe(id)
  })

  test('Escape closes the Theaters page and changes nothing', async ({ page }) => {
    await openHome(page)
    await page.locator('header').getByRole('button', { name: 'Theaters' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-theaters-page]')).toHaveCount(0)
    await expect(bar(page)).toBeHidden()
  })
})

test.describe('on the desk', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('the rail lists theaters and narrows the stories to one', async ({ page }) => {
    await openHome(page)
    const rail = page.locator('[data-desk-rail]')
    await rail.locator('[data-theater="israel-gaza"]').click()
    await expect(bar(page)).toContainText('Israel & Gaza')
    await expect(rail.locator('[data-desk-story]')).toHaveCount(1)
    await expect(page.locator('[data-desk-story-pane]')).toContainText('ceasefire talks resume')
    await rail.locator('[data-theater="israel-gaza"]').click()
    await expect(bar(page)).toBeHidden()
    expect(await rail.locator('[data-desk-story]').count()).toBeGreaterThan(20)
  })
})
