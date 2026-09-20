# WW3Watch API

WW3Watch is a static SPA backed by Supabase. There is no bespoke app server — the
public surface is four Supabase **Edge Functions** plus anon-readable feed
tables you can query directly or subscribe to over Realtime. Feedback is private
and write-only through its submission endpoint; operational tables are service-only.
The source of truth is the code under
[`supabase/functions/`](../supabase/functions) and the SQL migrations.

Base URL for functions:

```
https://qusjbpknlduuklnfciws.supabase.co/functions/v1
```

The functions set `verify_jwt = false` (the publishable key is not a JWT), so they
do not require visitor accounts. Feedback validates the public project key in
the `apikey` header. Daily keyed abuse identifiers, actual request-byte limits,
stored-content lookup and atomic provider budgets are the abuse controls — see
[`_shared/ratelimit.ts`](../supabase/functions/_shared/ratelimit.ts)
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
Readability, falling back to the page's NewsArticle JSON-LD `articleBody` when
Readability's pick is a link list or near-empty), cached in `article_content`
and SSRF-guarded on every redirect hop.

- **Input:** `?url=<article url>` (query) or `{ "url": "<article url>" }` (POST body).
- **Output (JSON):** `{ title, byline, content, contentVersion, siteName, fetchedAt, cached?, stale? }`.
  `content` is raw HTML — it is sanitized with DOMPurify **on the client** before
  rendering.
- **Errors:** `400 missing_url|invalid_url`, `404 unknown_article` (only URLs the
  pipeline ingested are allowed), `422 extraction_failed`, `429` (rate limited,
  ~120/h per IP, `Retry-After` set).

## `POST /translate`

Translates an article's title + body into a target language. Text-node-level, so
images and inline markup are preserved; same-language requests short-circuit.

- **Input (JSON):** `{ version: 2, url, mode, target, contentVersion? }`.
  Mode is `summary` or `reader`; reader mode requires the version returned by
  `/reader`. The server obtains all content and language from stored articles.
  Arbitrary client text is not accepted. `target` is a supported language (see
  [`_shared/lang.ts`](../supabase/functions/_shared/lang.ts)).
- **Output (JSON):** `{ title, content, untranslated, cached? }`. Reader HTML is
  reconstructed on the server and sanitized again before browser rendering.
  `untranslated` counts omitted segments due to length limits, not unchanged text.
- **Errors:** `400` invalid request, `404` unknown content, `409 refresh_required`
  stale reader version, `413` over 4096 request bytes, `426 upgrade_required`
  old interface, `429` quota/budget limits, `503` quota accounting unavailable,
  and `502` provider failure. Cached results do not start new provider work.
- Each provider attempt reserves cost atomically; reported usage reconciles it.
  An attempt with uncertain billing retains its charge reservation.

## `POST /feedback`

Send the public project key in `apikey`. Input: `{ category, message, articleId?,
email?, website? }`. Categories are `problem`, `correction`, `source`, `privacy`.
Messages must be 10–4000 characters. Email is optional; `website` is a honeypot.
No account or attachments are accepted. Limits are five submissions per hourly
abuse bucket, duplicate suppression, and 100 submissions per UTC day globally.
The response acknowledges submission without exposing private report contents.
Public database reads and updates are denied.

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
| `trending`  | the current trending picks — Jev-judged, code-ranked (`article_id`, `rank`, `story_id`) |
| `sources`   | the feed roster + health (`name`, `region`, `lang`, `enabled`, `last_ok_at`, `consecutive_failures`) |

RPCs:

- `pipeline_status()` → the timestamp of the last successful ingestion run (the
  app's "updated Xm ago" readout).

Realtime: the app subscribes to `postgres_changes` on `articles` (INSERT + a
recent-`fetched_at`-filtered UPDATE channel) and `trending` (all events) to keep
the feed live. See [`src/routes/+page.svelte`](../src/routes/+page.svelte).

> Story grouping is done **client-side** from `story_id` (`src/lib/cluster.ts`);
> the server assigns stories via multilingual embedding clustering in the pipeline.
