# WW3Watch API

WW3Watch is a static SPA backed by Supabase. There is no bespoke app server — the
public surface is three Supabase **Edge Functions** plus a set of anon-readable
tables you can query directly or subscribe to over Realtime. Everything here is
read-only and public by design; the source of truth is the code under
[`supabase/functions/`](../supabase/functions) and the SQL migrations.

Base URL for functions:

```
https://qusjbpknlduuklnfciws.supabase.co/functions/v1
```

The functions set `verify_jwt = false` (the publishable key is not a JWT), so they
can be called without auth. Per-IP rate limits and an article-URL allowlist are the
abuse controls — see [`_shared/ratelimit.ts`](../supabase/functions/_shared/ratelimit.ts)
and [`_shared/net.ts`](../supabase/functions/_shared/net.ts).

---

## `GET /rss`

Public RSS 2.0 feed of the newest stories (one item per story, newest member),
each linking to the in-app reader (`/?article=<id>`).

- **Response:** `application/rss+xml; charset=utf-8`
- **Caching:** `Cache-Control: public, max-age=900` — readers and CDNs should poll
  at most every ~15 minutes. Please honour it; egress is budget-constrained.
- No parameters, no auth.

```
curl https://qusjbpknlduuklnfciws.supabase.co/functions/v1/rss
```

## `GET|POST /reader`

Extracts the readable article body for a **known** article URL (Mozilla
Readability), cached in `article_content` and SSRF-guarded on every redirect hop.

- **Input:** `?url=<article url>` (query) or `{ "url": "<article url>" }` (POST body).
- **Output (JSON):** `{ title, byline, content, siteName, fetchedAt, cached?, stale? }`.
  `content` is raw HTML — it is sanitized with DOMPurify **on the client** before
  rendering.
- **Errors:** `400 missing_url|invalid_url`, `404 unknown_article` (only URLs the
  pipeline ingested are allowed), `422 extraction_failed`, `429` (rate limited,
  ~120/h per IP, `Retry-After` set).

## `POST /translate`

Translates an article's title + body into a target language. Text-node-level, so
images and inline markup are preserved; same-language requests short-circuit.

- **Input (JSON):** `{ title, content, lang, url, target }` — `lang` is the source
  language code, `target` is one of the supported reading languages (see
  [`_shared/lang.ts`](../supabase/functions/_shared/lang.ts)).
- **Output (JSON):** `{ title, content }` in the target language.
- **Errors:** `400` (bad target / oversized body), `429` (rate limited, ~20/h per
  IP), `502` (translation provider failure / partial response — not cached).

---

## Direct table reads (Supabase REST + Realtime)

Read with the **publishable** key (public, ships in the deployed bundle):

```
SUPABASE_URL  = https://qusjbpknlduuklnfciws.supabase.co
PUBLISHABLE   = sb_publishable_...   (anon, read-only via RLS)
```

Anon-readable tables:

| Table       | What it holds                                                        |
|-------------|----------------------------------------------------------------------|
| `articles`  | ingested articles (title, url, summary, published/fetched, source\_\*, `story_id`, `body_hash`) |
| `trending`  | the current LLM-curated trending picks (`article_id`, `rank`, `story_id`) |
| `sources`   | the feed roster + health (`name`, `region`, `lang`, `enabled`, `last_ok_at`, `consecutive_failures`) |

RPCs:

- `pipeline_status()` → the timestamp of the last successful ingestion run (the
  app's "updated Xm ago" readout).

Realtime: the app subscribes to `postgres_changes` on `articles` (INSERT + a
recent-`fetched_at`-filtered UPDATE channel) and `trending` (all events) to keep
the feed live. See [`src/routes/+page.svelte`](../src/routes/+page.svelte).

> Story grouping is done **client-side** from `story_id` (`src/lib/cluster.ts`);
> the server assigns stories via multilingual embedding clustering in the pipeline.
