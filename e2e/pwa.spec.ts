import { test, expect } from '@playwright/test'

// The service worker is generated over the finished build (vite.config.ts),
// where nothing else would notice it missing: the plugin that used to write it
// kept "succeeding" under SvelteKit 3 while writing no worker at all. Readers'
// alarm subscriptions belong to its registration, so its URL and scope must
// not move, and it is what serves the site offline.
test('the service worker registers at /sw.js, carries the push handlers and serves pages offline', async ({ page, context }) => {
  await page.goto('/')
  const registration = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready
    return { script: r.active?.scriptURL, scope: r.scope }
  })
  expect(registration).toEqual({ script: new URL('/sw.js', page.url()).href, scope: new URL('/', page.url()).href })
  expect(await (await page.request.get('/sw.js')).text()).toContain('importScripts("push-sw.js")')

  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  for (const path of ['/about', '/feedback?article=x', '/']) {
    const response = await page.goto(path)
    expect(response?.fromServiceWorker(), path).toBe(true)
    expect(response?.status(), path).toBe(200)
  }
  await expect(page).toHaveTitle(/WW3Watch/)
})

test('the web app manifest resolves, with icons that exist', async ({ page, request }) => {
  await page.goto('/about')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const url = new URL(href!, page.url())
  const manifest = await (await request.get(url.href)).json()
  expect(new URL(manifest.start_url, url).pathname).toBe('/')
  expect(new URL(manifest.scope, url).pathname).toBe('/')
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, url).href)
    expect(response.headers()['content-type'], icon.src).toContain('image/png')
  }
})
