// WW3Watch feed-proxy — Cloudflare Worker.
//
// Why: many news-site WAFs block GitHub Actions' datacenter IPs, which killed
// 158/200 RSS feeds. The pipeline retries failed fetches through this Worker;
// Cloudflare egress IPs are rarely blocked. Free tier: 100k req/day (we need
// ~15k/day worst case), no metered egress.
//
// Deploy: automated by .github/workflows/deploy-worker.yml on any push to
// cloudflare/** on main (config in cloudflare/wrangler.toml), gated on the repo
// secrets CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID. Manual fallback:
// `npx wrangler deploy` from cloudflare/. The Worker secret FEED_PROXY_SECRET is
// NOT managed by the deploy — set it once via `wrangler secret put FEED_PROXY_SECRET`
// (or the dashboard) to the same random string stored as the GitHub Actions secret.
//
// Usage: GET {worker-url}?url=<encoded feed url>  with header  x-proxy-key: <secret>

export default {
  async fetch(request, env) {
    if (request.headers.get('x-proxy-key') !== env.FEED_PROXY_SECRET) {
      return new Response('unauthorized', { status: 401 })
    }

    const target = new URL(request.url).searchParams.get('url')
    if (!target) return new Response('missing url', { status: 400 })

    let url
    try {
      url = new URL(target)
    } catch {
      return new Response('invalid url', { status: 400 })
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return new Response('invalid url', { status: 400 })
    }
    // Feeds are always public hostnames — reject literal IPs and internal names
    // outright (defense-in-depth; Workers egress can't reach private ranges anyway).
    const host = url.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
      host.includes(':')
    ) {
      return new Response('blocked host', { status: 400 })
    }

    try {
      const upstream = await fetch(url, {
        headers: {
          // Match the app's direct-path headers (src/lib/server/rss.ts). A real
          // browser UA + Accept-Language gets past WAFs that 403 a bot UA.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      })
      // Buffer the body HERE, inside the try: streaming upstream.body straight
      // through surfaces a mid-stream origin reset to the caller as an opaque
      // "TypeError: fetch failed". Reading it now turns that into a clean,
      // diagnosable 502 and lets a slow body finish within our budget.
      const body = await upstream.text()
      return new Response(body, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' },
      })
    } catch (err) {
      return new Response(`upstream fetch failed: ${err?.name ?? 'error'}: ${err?.message ?? ''}`.slice(0, 200), {
        status: 502,
      })
    }
  },
}
