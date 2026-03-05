# WW3Watch

A real-time global news aggregator focused on geopolitical conflict and world events. Aggregates articles from dozens of sources across every major region, clusters related stories using LLM-assisted grouping, and surfaces trending stories as they break.

**Live at [ww3watch.vercel.app](https://ww3watch.vercel.app)**

## Features

- **Real-time feed** — new articles appear live via Supabase Realtime without a page refresh
- **Story clustering** — related articles from multiple sources are grouped together automatically
- **Trending Now** — LLM-ranked top stories updated continuously
- **In-app reader** — read articles without leaving the site; falls back to summary if extraction fails
- **Multi-source view** — see every outlet covering a story and switch between versions in the reader
- **Region filtering** — filter by US/Western, European, Arab/Gulf, Chinese, Russian, South Asian, and more
- **PWA** — installable on mobile, works as a home screen app

## Stack

- [SvelteKit](https://kit.svelte.dev/) + Svelte 5 runes
- [Supabase](https://supabase.com/) (Postgres + Realtime)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Vercel](https://vercel.com/) (hosting + serverless functions)

## Development

```bash
npm install
npm run dev
```

Requires a `.env` with Supabase and LLM API credentials.
