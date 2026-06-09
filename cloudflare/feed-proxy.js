// WW3Watch feed-proxy — Cloudflare Worker.
//
// Why: many news-site WAFs block GitHub Actions' datacenter IPs, which killed
// 158/200 RSS feeds. The pipeline retries failed fetches through this Worker;
// Cloudflare egress IPs are rarely blocked. Free tier: 100k req/day (we need
// ~15k/day worst case), no metered egress.
//
// Deploy: Cloudflare dashboard → Workers → create "feed-proxy" → paste this file
// (or `npx wrangler deploy cloudflare/feed-proxy.js --name feed-proxy`).
// Then set the Worker secret FEED_PROXY_SECRET (Settings → Variables and Secrets)
// to the same random string stored as the GitHub Actions secret.
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
          'User-Agent': 'WW3Watch/1.0 (news aggregator)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      })
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' },
      })
    } catch (err) {
      return new Response(`upstream fetch failed: ${err?.name ?? 'error'}`, { status: 502 })
    }
  },
}
