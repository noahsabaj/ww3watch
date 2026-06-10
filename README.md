# WW3Watch

A real-time global news aggregator focused on geopolitical conflict and world events. Aggregates articles from 200+ sources across every major region, clusters related stories using LLM-assisted grouping, and surfaces trending stories as they break.

**Live at [noahsabaj.github.io/ww3watch](https://noahsabaj.github.io/ww3watch/)**

## Features

- **Real-time feed** — new articles appear live via Supabase Realtime without a page refresh
- **Story clustering** — related articles from multiple sources are grouped together automatically
- **Trending Now** — LLM-ranked top stories updated continuously
- **In-app reader** — read articles without leaving the site; falls back to summary if extraction fails
- **Multi-source view** — see every outlet covering a story and switch between versions in the reader
- **Region filtering** — filter by US/Western, European, Arab/Gulf, Chinese, Russian, South Asian, and more
- **PWA** — installable on mobile, works as a home screen app

## Stack

All free-tier, no provider that pauses idle hobby projects:

- [SvelteKit](https://kit.svelte.dev/) + Svelte 5 runes — static SPA (`adapter-static`)
- [GitHub Pages](https://pages.github.com/) — hosting · [GitHub Actions](https://docs.github.com/actions) — scheduled ingestion pipeline
- [Supabase](https://supabase.com/) — Postgres + Realtime + two Deno Edge Functions (`reader`, `translate`)
- [Cerebras](https://cloud.cerebras.ai/) — OpenAI-compatible LLM (classification, clustering, trending, translation)
- [Tailwind CSS v4](https://tailwindcss.com/)

## Architecture

```
GitHub Actions (cron, every 15 min)        Browser (static SPA on GitHub Pages)
  scripts/run-pipeline.ts                     +page.ts  ── anon read ──►  Supabase
    fetch 200+ RSS feeds                       realtime sub ◄── INSERTs ── Postgres
    de-dup vs DB (only new GUIDs)              ArticlePanel ──► Edge Functions
    classify + cluster (LLM)                                     reader   (extract)
    upsert ─────────────────►  Supabase Postgres                translate (LLM)
    recompute trending
```

- **Ingestion** is a Node script run by GitHub Actions ([.github/workflows/pipeline.yml](.github/workflows/pipeline.yml)). It reuses `src/lib/server/*` and writes to Supabase. RSS/Readability libs need Node, which the Actions runner provides.
- **Frontend** is a static SPA. The initial load ([src/routes/+page.ts](src/routes/+page.ts)) reads with the anon key; [Realtime](src/routes/+page.svelte) keeps it live.
- **`reader` / `translate`** run as Supabase Edge Functions ([supabase/functions](supabase/functions)) — they need a server (SSRF-guarded fetch, the LLM key). Returned HTML is sanitized on the client with DOMPurify before `{@html}`.

## Development

```bash
npm install
npm run dev          # frontend (needs PUBLIC_SUPABASE_* in .env)
npm test             # vitest
npm run check        # svelte-check

# run the ingestion pipeline once, locally:
node --import tsx --env-file=.env scripts/run-pipeline.ts
```

Copy `.env.example` → `.env` and fill in credentials.

## Deploy / setup

One-time setup (all free tier):

1. **Cerebras** — create an API key at [cloud.cerebras.ai](https://cloud.cerebras.ai/); note the model (`gpt-oss-120b`).
2. **Supabase**
   - Enable RLS on `articles` and `trending` with policies allowing **anon `SELECT`** (the SPA + realtime read with the anon key; writes stay service-role only).
   - Ensure `articles` is in the `supabase_realtime` publication.
   - Deploy the functions and set their secrets:
     ```bash
     supabase functions deploy reader translate
     supabase secrets set LLM_BASE_URL=https://api.cerebras.ai/v1 LLM_API_KEY=... LLM_MODEL=gpt-oss-120b
     ```
3. **GitHub**
   - Repo **Settings → Secrets and variables → Actions** → add: `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (the `sb_secret_…` key), `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and (optional) `FEED_PROXY_URL` + `FEED_PROXY_SECRET`.
   - **Settings → Pages** → Source = **GitHub Actions**.
   - Push to `main`: [deploy.yml](.github/workflows/deploy.yml) publishes the site; [pipeline.yml](.github/workflows/pipeline.yml) ingests every 15 min (or run it manually via **Actions → Ingestion pipeline → Run workflow**).
4. **Feed proxy (optional but recommended)** — many news-site WAFs block GitHub Actions' datacenter IPs, killing most feeds. Deploy [cloudflare/feed-proxy.js](cloudflare/feed-proxy.js) as a Cloudflare Worker, set its `FEED_PROXY_SECRET` secret, and add `FEED_PROXY_URL`/`FEED_PROXY_SECRET` to the GitHub Actions secrets above. The pipeline then retries blocked feeds through it (free tier covers it). DB schema lives in [supabase/migrations](supabase/migrations).

> The site deploys to `https://<user>.github.io/ww3watch` (the `BASE_PATH=/ww3watch` in the deploy workflow handles the sub-path). For a custom domain, set `BASE_PATH` to empty and add a `CNAME`.

> Scheduled GitHub Actions are auto-disabled after 60 days of **repo** inactivity — ordinary commits keep them alive.

## License

[AGPL-3.0](LICENSE) — the copyleft that applies to network services: if you run a
modified WW3Watch as a website, you must offer your users the modified source.
Chosen deliberately. This project's credibility rests on its pipeline being
auditable — the LLM routes stories (classification, clustering, trending) but
never rewrites what journalists wrote — and AGPL keeps every public derivative
auditable on the same terms. The license covers this code, not the aggregated
news content, which belongs to its publishers.
