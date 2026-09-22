import { test, expect, type Page } from '@playwright/test'
import { openHome, reader, selectStory, storyCard } from './home'

type ShareMock = {
  copied: string[]
  shared: ShareData[]
  clipboardFails: boolean
  shareError: string
  releaseCopy?: () => void
  deferCopy: boolean
}
declare global { interface Window { shareMock: ShareMock } }

test('prerendered pages contain matching social metadata without JavaScript', async ({ request }) => {
  for (const path of ['/', '/about', '/trends', '/privacy', '/feedback']) {
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    const html = await response.text()
    const meta = (key: string) => {
      const tags = [...html.matchAll(/<meta\s[^>]*>/g)].map(match => match[0])
        .filter(tag => tag.includes(`="${key}"`))
      expect(tags).toHaveLength(1)
      return tags[0].match(/content="([^"]*)"/)?.[1]
    }
    expect(meta('twitter:title')).toBe(meta('og:title'))
    expect(meta('twitter:description')).toBe(meta('og:description'))
    expect(meta('twitter:image')).toBe('https://ww3watch.org/og.png')
    expect(meta('twitter:image')).toBe(meta('og:image'))
    expect(meta('twitter:image:alt')).toBe(meta('og:image:alt'))
    expect(meta('og:url')).toBe(`https://ww3watch.org${path}`)
  }
  const image = await request.get('/og.png')
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toContain('image/png')
})

async function setup(page: Page, native = false) {
  await page.addInitScript((native) => {
    window.shareMock = { copied: [], shared: [], clipboardFails: false, shareError: '', deferCopy: false }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => {
        if (window.shareMock.clipboardFails) throw new DOMException('Denied', 'NotAllowedError')
        if (window.shareMock.deferCopy) await new Promise<void>(resolve => { window.shareMock.releaseCopy = resolve })
        window.shareMock.copied.push(text)
      },
    } })
    Object.defineProperty(navigator, 'share', { configurable: true, value: native ? async (data: ShareData) => {
      if (window.shareMock.shareError) throw new DOMException('Share failed', window.shareMock.shareError)
      window.shareMock.shared.push(data)
    } : undefined })
  }, native)
  await openHome(page, '/?utm_source=sharing-test')
}

test('card copies a clean story link without changing filters, reader or history; link opens cold', async ({ page }) => {
  await setup(page)
  const card = await selectStory(page, { hasText: 'ceasefire talks resume' })
  const originalUrl = page.url()
  const depth = await page.evaluate(() => history.length)
  const search = page.locator('header input[type="text"]')
  await search.fill('ceasefire')
  await card.getByRole('button', { name: 'Copy story link' }).click()
  await expect(card.getByRole('status')).toHaveText('Link copied')
  await expect(search).toHaveValue('ceasefire')
  await expect(page).toHaveURL(originalUrl)
  expect(await page.evaluate(() => history.length)).toBe(depth)
  await expect(reader(page)).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0)
  const copied = await page.evaluate(() => window.shareMock.copied[0])
  expect(copied).toMatch(/^https:\/\/ww3watch.org\/\?story=[0-9a-f-]{36}$/)
  await page.goto(new URL(copied).search)
  await expect(reader(page)).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Close reader').click()
  await expect(reader(page)).toHaveCount(0)
  await expect(storyCard(page)).toBeVisible()
})

test('single article copies from keyboard and its link reopens the correct article', async ({ page }) => {
  await setup(page)
  const card = await selectStory(page, { hasText: /\b1 outlet\b/ })
  const original = await card.locator('a[href]').first().getAttribute('href')
  const button = card.getByRole('button', { name: 'Copy article link' })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(card.getByRole('status')).toHaveText('Link copied')
  const copied = await page.evaluate(() => window.shareMock.copied[0])
  expect(copied).toMatch(/^https:\/\/ww3watch.org\/\?article=[0-9a-f-]{36}$/)
  await page.goto(new URL(copied).search)
  const dialog = reader(page)
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog.getByRole('link', { name: 'Read original ↗', exact: true })).toHaveAttribute('href', original!)
  await dialog.getByRole('button', { name: 'Copy article link' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Link copied')
  expect(await page.evaluate(() => window.shareMock.copied[0])).toBe(copied)
})

test('blocked clipboard offers a selectable link; retry succeeds', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { window.shareMock.clipboardFails = true })
  const card = storyCard(page)
  await card.getByRole('button', { name: /Copy .* link/ }).click()
  await expect(card.getByRole('status')).toContainText('Could not copy automatically')
  const input = card.getByRole('textbox', { name: /Link to/ })
  await input.focus()
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe((await input.inputValue()).length)
  await page.evaluate(() => { window.shareMock.clipboardFails = false })
  await card.getByRole('button', { name: /Copy .* link/ }).click()
  await expect(card.getByRole('status')).toHaveText('Link copied')
  await expect(input).toHaveCount(0)
})

test('native share sends original headline and link, cancellation is silent, errors offer copying', async ({ page }) => {
  await setup(page, true)
  const card = storyCard(page)
  const originalTitle = (await card.locator('a[href]').first().innerText()).trim()
  const share = card.getByRole('button', { name: 'Share', exact: true })
  await share.click()
  expect(await page.evaluate(() => window.shareMock.shared[0])).toMatchObject({ title: originalTitle, url: expect.stringMatching(/^https:\/\/ww3watch.org\/\?/) })
  await page.evaluate(() => { window.shareMock.shareError = 'AbortError' })
  await share.click()
  await expect(share).toBeEnabled()
  await expect(card.getByRole('status')).toBeEmpty()
  await expect(card.getByRole('textbox')).toHaveCount(0)
  await page.evaluate(() => { window.shareMock.shareError = 'NotAllowedError' })
  await share.click()
  await expect(card.getByRole('status')).toHaveText('Sharing is unavailable. Copy the link instead.')
  await expect(card.getByRole('textbox', { name: /Link to/ })).toBeVisible()
})

test('reader source changes reset feedback and ignore an old pending copy; Back still closes reader', async ({ page }) => {
  await setup(page)
  await (await selectStory(page, { hasText: /\d+ outlets/ })).locator('a[href]').first().click()
  const dialog = reader(page)
  const copy = dialog.getByRole('button', { name: 'Copy story link' })
  await copy.click()
  await expect(dialog.getByRole('status')).toHaveText('Link copied')
  await dialog.locator('button[dir="auto"]').first().click()
  await expect(dialog.getByRole('status')).toBeEmpty()
  await page.evaluate(() => { window.shareMock.deferCopy = true })
  await copy.click()
  await expect(copy).toBeDisabled()
  await dialog.locator('button[dir="auto"]').first().click()
  await expect(copy).toBeEnabled()
  await page.evaluate(() => { window.shareMock.releaseCopy?.() })
  await expect(dialog.getByRole('status')).toBeEmpty()
  await page.goBack()
  await expect(dialog).toHaveCount(0)
})

for (const width of [320, 390, 430, 1280]) {
  test(`sharing controls fit at ${width}px on cards and reader`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await setup(page, true)
    const card = storyCard(page)
    const check = async (container: ReturnType<Page['locator']>) => {
      for (const button of await container.locator('[data-share-controls] button').all()) {
        await expect(button).toBeVisible()
        // The reader slides in; wait for its controls to reach the viewport.
        await expect.poll(async () => {
          const rect = await button.boundingBox()
          return !!rect && rect.x >= 0 && rect.x + rect.width <= width
        }).toBe(true)
        const box = (await button.boundingBox())!
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      }
    }
    await check(card)
    await card.locator('a[href]').first().click()
    const dialog = reader(page)
    await expect(dialog).toBeVisible()
    await check(dialog)
    await page.evaluate(() => { window.shareMock.clipboardFails = true })
    await dialog.getByRole('button', { name: /Copy .* link/ }).click()
    await expect(dialog.getByRole('textbox', { name: /Link to/ })).toBeVisible()
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
}
