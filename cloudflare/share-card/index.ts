// WW3Watch share-card — Cloudflare Worker in front of ww3watch.org.
//
// Why: the site is a static app on GitHub Pages, and link previews (iMessage,
// WhatsApp, Slack, X…) read the page's meta tags without running it, so every
// shared story used to show the same site card. For /?story= and /?article=
// this rewrites those tags with the story's headline, sources and publisher
// photograph (src/lib/share-card.ts). Everything else, and any failure, is the
// untouched GitHub Pages response: the Worker can only ever improve a card.
//
// Local check: `npx wrangler dev` with ORIGIN=https://ww3watch.org in .dev.vars,
// then curl http://localhost:8787/?story=<id>.

import { CARD_COLUMNS, shareCard, type CardRow, type ShareCard } from '../../src/lib/share-card'

interface Env {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  /** Dev only: where to fetch the page from instead of the real origin. */
  ORIGIN?: string
}

const ID = /^[A-Za-z0-9_-]{1,64}$/

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = () =>
      env.ORIGIN ? fetch(new Request(new URL(url.pathname + url.search, env.ORIGIN), request)) : fetch(request)

    const story = url.searchParams.get('story')
    const article = url.searchParams.get('article')
    const id = story ?? article
    if (request.method !== 'GET' || url.pathname !== '/' || !id || !ID.test(id)) return origin()

    const kind = story ? 'story' : 'article'
    const [page, card] = await Promise.all([origin(), loadCard(env, kind, id).catch(() => null)])
    if (!card || !page.ok || !page.headers.get('content-type')?.includes('text/html')) return page
    return rewrite(page, card)
  },
}

async function rows(env: Env, filter: string): Promise<CardRow[]> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/articles?select=${CARD_COLUMNS}&${filter}&order=published_at.desc.nullslast&limit=100`,
    {
      headers: { apikey: env.SUPABASE_ANON_KEY },
      // A popular link is previewed by many chats at once; five minutes of edge
      // cache keeps that to one query without letting a card go stale.
      cf: { cacheTtl: 300, cacheEverything: true },
    },
  )
  if (!res.ok) throw new Error(`supabase ${res.status}`)
  return res.json()
}

async function loadCard(env: Env, kind: 'story' | 'article', id: string): Promise<ShareCard | null> {
  if (kind === 'story') return shareCard(kind, id, null, await rows(env, `story_id=eq.${id}`))
  const [target] = await rows(env, `id=eq.${id}`)
  if (!target) return null
  const members = target.story_id ? await rows(env, `story_id=eq.${target.story_id}`) : []
  return shareCard(kind, id, target, members)
}

function rewrite(page: Response, card: ShareCard): Response {
  const set = (value: string) => ({ element: (el: Element) => { el.setAttribute('content', value) } })
  const drop = { element: (el: Element) => { el.remove() } }
  const img = card.image
  const dims = img?.width && img?.height ? { w: String(img.width), h: String(img.height) } : null

  let r = new HTMLRewriter()
    .on('title', { element: (el) => { el.setInnerContent(`${card.title} — WW3Watch`) } })
    .on('meta[name="description"]', set(card.description))
    .on('link[rel="canonical"]', { element: (el) => { el.setAttribute('href', card.url) } })
    .on('meta[property="og:title"], meta[name="twitter:title"]', set(card.title))
    .on('meta[property="og:description"], meta[name="twitter:description"]', set(card.description))
    .on('meta[property="og:type"]', set('article'))
    .on('meta[property="og:url"]', set(card.url))
    .on('head', {
      element: (el) => { el.append('<meta property="og:site_name" content="WW3Watch">', { html: true }) },
    })
  if (img) {
    r = r
      .on('meta[property="og:image"], meta[name="twitter:image"]', set(img.url))
      .on('meta[property="og:image:alt"], meta[name="twitter:image:alt"]', set(img.alt))
      .on('meta[property="og:image:width"]', dims ? set(dims.w) : drop)
      .on('meta[property="og:image:height"]', dims ? set(dims.h) : drop)
  }

  const res = r.transform(page)
  const headers = new Headers(res.headers)
  // The same page for every link, but the card differs per query string.
  headers.set('Cache-Control', 'public, max-age=300')
  return new Response(res.body, { status: res.status, headers })
}
