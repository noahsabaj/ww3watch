<script lang="ts">
  import { page } from '$app/state'
  import { base } from '$app/paths'
  const pages: Record<string, [string, string]> = {
    '/': ['WW3Watch — Global conflict news from multiple perspectives', 'Follow global conflict and geopolitical reporting, compare sources, and read original articles. Automated labels help organize coverage; they do not verify claims.'],
    '/about': ['About & methodology — WW3Watch', 'How WW3Watch selects sources, groups reporting and labels stories, with the active source roster and source health.'],
    '/trends': ['Trends — WW3Watch', 'Explore the last 30 days of conflict reporting by party and the stories classified as major events.'],
    '/privacy': ['Privacy — WW3Watch', 'How WW3Watch handles local preferences, security records, article images, translation requests and private feedback.'],
    '/feedback': ['Feedback & corrections — WW3Watch', 'Privately report a problem, request a correction or suggest a news source. No account required.'],
  }
  const path = $derived((page.url.pathname.slice(base.length).replace(/\/$/, '') || '/'))
  const meta = $derived(pages[path] ?? pages['/'])
  const canonical = $derived(`https://ww3watch.org${path === '/' ? '/' : path}`)
</script>

<svelte:head>
  <title>{meta[0]}</title>
  <meta name="description" content={meta[1]} />
  <link rel="canonical" href={canonical} />
  <meta property="og:title" content={meta[0]} />
  <meta property="og:description" content={meta[1]} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonical} />
  <meta property="og:image" content="https://ww3watch.org/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="alternate" type="application/rss+xml" title="WW3Watch RSS" href="https://qusjbpknlduuklnfciws.supabase.co/functions/v1/rss" />
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"WW3Watch","url":"https://ww3watch.org/","description":"Global conflict reporting from multiple perspectives"}</script>
</svelte:head>
