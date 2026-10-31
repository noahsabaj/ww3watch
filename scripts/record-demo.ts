// Records docs/demo.gif, the README's picture of the site: half a minute on the
// story desk, driven by Playwright and encoded with sharp, so it is made again
// when the site changes rather than by hand.
//
//   npm run dev       (or point --url at a preview, or the live site)
//   node --import tsx scripts/record-demo.ts [--url http://localhost:5173/] [--out docs/demo.gif]
//
// It shows whatever the site's backend serves: the live feed, photographs and
// all. When that backend is unavailable, --fixture DIR serves a saved copy of
// the public feed instead, to a site built against any Supabase URL:
// DIR/articles.json (the 500 newest rows in FEED_COLUMNS), trending.json,
// status.json (pipeline_status) and, optionally, reader.json (the reader's
// cached extractions: url, title, byline, content, fetchedAt). Realtime is
// answered locally, the newest article arrives over it partway through, and
// --at ISO-TIME freezes the clock at when the copy was taken, so "3m ago"
// reads as it did. Nothing is ever made up: a photograph the browser cannot
// load shows as the colour field, as it does on the site.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test'
import sharp from 'sharp'

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const URL_ = arg('url') ?? 'http://localhost:5173/'
const OUT = arg('out') ?? 'docs/demo.gif'
const FIXTURE = arg('fixture')
const AT = arg('at')
// The desk at a laptop's size, drawn at 1.5x and halved: sharp text at 960 px.
const VIEWPORT = { width: 1280, height: 800 }
const SCALE = 1.5
const WIDTH = 960

type Row = Record<string, unknown> & { id: string; story_id: string | null; fetched_at: string; url: string }
type Fixture = { articles: Row[]; trending: unknown[]; status: unknown; reader: Array<Record<string, unknown> & { url: string }> }

function loadFixture(dir: string): Fixture {
  const read = (file: string, fallback?: unknown) => {
    try {
      return JSON.parse(readFileSync(join(dir, file), 'utf8'))
    } catch (err) {
      if (fallback !== undefined) return fallback
      throw err
    }
  }
  return { articles: read('articles.json'), trending: read('trending.json'), status: read('status.json'), reader: read('reader.json', []) }
}

// The REST calls the feed makes (src/lib/load-feed.ts, feed.svelte.ts), the
// reader function, and Realtime's joins. `held` is kept back from the REST
// answers until it arrives over Realtime.
async function serveFixture(context: BrowserContext, fx: Fixture, held: Row | undefined) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json; charset=utf-8', headers: cors, body: JSON.stringify(body) })
  let arrived = false
  await context.route(/\/rest\/v1\//, (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    const path = url.pathname.split('/rest/v1/')[1]
    if (path === 'rpc/pipeline_status') return route.fulfill(json(fx.status))
    if (path === 'trending') return route.fulfill(json(fx.trending))
    if (path !== 'articles') return route.fulfill(json([]))
    const p = url.searchParams
    const eq = (k: string) => (p.get(k)?.startsWith('eq.') ? p.get(k)!.slice(3) : null)
    let rows = fx.articles.filter((a) => arrived || a !== held)
    if (eq('id')) rows = rows.filter((a) => a.id === eq('id'))
    if (eq('story_id')) rows = rows.filter((a) => a.story_id === eq('story_id'))
    const since = p.get('fetched_at')
    if (since?.startsWith('gte.')) rows = rows.filter((a) => a.fetched_at >= since.slice(4))
    const offset = Number(p.get('offset') ?? 0)
    rows = rows.slice(offset, offset + Number(p.get('limit') ?? rows.length))
    if ((req.headers()['accept'] ?? '').includes('vnd.pgrst.object')) return route.fulfill(rows[0] ? json(rows[0]) : json({ code: 'PGRST116' }, 406))
    return route.fulfill(json(rows))
  })
  await context.route(/\/functions\/v1\/reader/, (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const { url } = route.request().postDataJSON() as { url: string }
    const cached = fx.reader.find((r) => r.url === url)
    return route.fulfill(cached ? json({ ...cached, contentVersion: 'fixture' }) : json({ error: 'extraction_failed' }, 422))
  })
  // Realtime protocol 2.0.0: [join_ref, ref, topic, event, payload]. A join is
  // answered with its postgres_changes bindings, each given an id.
  let arrive: (() => void) | undefined
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws: WebSocketRoute) => {
    ws.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw))
      if (event === 'phx_join') {
        const bindings = ((payload?.config?.postgres_changes ?? []) as Array<Record<string, unknown>>)
          .map((b, i): Record<string, unknown> & { id: number } => ({ ...b, id: 1000 + i }))
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings } }]))
        const insert = bindings.find((b) => b.event === 'INSERT' && b.table === 'articles')
        if (insert && held) {
          arrive = () => {
            arrived = true
            const data = { type: 'INSERT', schema: 'public', table: 'articles', commit_timestamp: held.fetched_at, columns: [], record: held, errors: null }
            ws.send(JSON.stringify([null, null, topic, 'postgres_changes', { ids: [insert.id], data }]))
          }
        }
      } else {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]))
      }
    })
  })
  return { arrive: () => arrive?.() }
}

const frames: Array<{ png: Buffer; ms: number }> = []
async function shot(page: Page, ms: number) {
  frames.push({ png: await page.screenshot({ animations: 'disabled' }), ms })
}
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** Scroll what scrolls inside `selector` (itself, or the first descendant that
 *  overflows: the reader scrolls its own body) to `to`, a frame a step. */
async function glide(page: Page, selector: string, to: number, steps = 12) {
  // (No named helpers in here: tsx wraps them in a __name() the page lacks.)
  const target = await page.locator(selector).evaluate((root) => {
    const el = [root, ...root.querySelectorAll('*')].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 8) ?? root
    document.querySelectorAll('[data-demo-scroller]').forEach((e) => e.removeAttribute('data-demo-scroller'))
    el.setAttribute('data-demo-scroller', '')
    return el.scrollTop
  })
  for (let i = 1; i <= steps; i++) {
    const y = target + (to - target) * ease(i / steps)
    await page.locator('[data-demo-scroller]').evaluate((el, top) => el.scrollTo({ top, behavior: 'instant' }), y)
    await shot(page, 60)
  }
}

// Every photograph loaded, or given up on for the colour field (StoryPhotoImg
// tries the resized copy, then the original), before a frame is taken.
async function settle(page: Page, ms = 450) {
  const images = () => page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 8000 }).catch(() => {})
  await page.waitForLoadState('networkidle').catch(() => {})
  await images()
  await page.waitForTimeout(ms)
  await images()
}

async function record() {
  const fx = FIXTURE ? loadFixture(FIXTURE) : null
  // The newest report arrives live, partway through.
  const held = fx?.articles[0]
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {})
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: 'dark', reducedMotion: 'reduce',
    serviceWorkers: 'block', locale: 'en-US', timezoneId: 'UTC',
  })
  const backend = fx ? await serveFixture(context, fx, held) : { arrive: () => {} }
  const page = await context.newPage()
  if (AT) await page.clock.setFixedTime(new Date(AT))
  await page.goto(URL_, { waitUntil: 'networkidle' })
  await page.locator('[data-desk-pane]').waitFor()
  await settle(page, 1200)
  const pane = '[data-desk-pane]'

  // 1. The desk: every story in a column, the most important one open.
  await shot(page, 2400)
  // 2. How each newsroom put it, side by side by region.
  const newsrooms = page.locator(`${pane} section[aria-labelledby^="newsrooms-"]`)
  const newsroomsTop = () => newsrooms.evaluate((el) => (el as HTMLElement).offsetTop - 24)
  await glide(page, pane, await newsroomsTop())
  await shot(page, 2200)
  // 3. The same reports as a timeline: who had it first.
  await page.getByRole('group', { name: 'Story view' }).getByRole('button', { name: 'Timeline' }).click()
  await settle(page)
  await shot(page, 2000)
  await page.getByRole('group', { name: 'Story view' }).getByRole('button', { name: 'By side' }).click()
  await page.locator(pane).evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }))

  // 4. Trending's second story, and one newsroom's report in the reader.
  await page.locator('[data-trending-story]').nth(1).click()
  await settle(page)
  await shot(page, 1600)
  const cachedUrls = new Set((fx?.reader ?? []).map((r) => r.url))
  const reports = newsrooms.locator('a[href]')
  const count = await reports.count()
  let pick = 0
  for (let i = 0; i < count && cachedUrls.size; i++) if (cachedUrls.has((await reports.nth(i).getAttribute('href')) ?? '')) { pick = i; break }
  await glide(page, pane, await newsroomsTop(), 8)
  await reports.nth(pick).click()
  await settle(page, 700)
  await shot(page, 3200)
  await page.keyboard.press('Escape')
  await settle(page)

  // 5. Down the rail, j through the stories, each in the language it was written in.
  const rail = '[data-desk-rail]'
  await glide(page, rail, await page.locator(`${rail} [data-day]`).first().evaluate((el) => (el as HTMLElement).offsetTop - 8), 10)
  await page.locator(`${rail} [data-desk-story]`).first().click()
  await settle(page, 350)
  await shot(page, 1300)
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('j')
    await settle(page, 350)
    await shot(page, 1300)
  }

  // 6. A report arrives (with a fixture, over the local socket): it waits
  //    behind the pill while the rail is scrolled, and joins it on a click.
  if (held) {
    backend.arrive()
    await page.getByRole('button', { name: /new stor/ }).waitFor({ timeout: 10_000 })
    await settle(page, 300)
    await shot(page, 2000)
    await page.getByRole('button', { name: /new stor/ }).click()
    await settle(page, 400)
    await page.locator(`${rail} [data-desk-story]`).first().click()
    await settle(page, 400)
    await shot(page, 2200)
  }

  // 7. Search, across every language's headlines held.
  const search = page.getByPlaceholder('Search headlines')
  await search.click()
  for (const ch of 'Iran') {
    await search.press(ch)
    await page.waitForTimeout(120)
    await shot(page, 140)
  }
  await settle(page, 500)
  await shot(page, 2600)
  await browser.close()

  console.log(`[demo] ${frames.length} frames, ${(frames.reduce((s, f) => s + f.ms, 0) / 1000).toFixed(1)} s`)
  const height = Math.round((WIDTH * VIEWPORT.height) / VIEWPORT.width)
  const scaled = await Promise.all(frames.map((f) => sharp(f.png).resize(WIDTH, height, { kernel: 'lanczos3' }).png().toBuffer()))
  const info = await sharp(scaled, { join: { animated: true } })
    .gif({ delay: frames.map((f) => f.ms), loop: 0, effort: 10, interFrameMaxError: 4, interPaletteMaxError: 8 })
    .toFile(OUT)
  console.log(`[demo] wrote ${OUT}: ${info.width}x${height}, ${(info.size / 1e6).toFixed(1)} MB`)
}

await record()
