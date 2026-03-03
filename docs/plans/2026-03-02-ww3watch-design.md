# WW3Watch — Design Document
*2026-03-02*

## Purpose

A public, real-time news feed aggregator for the 2026 Iran-Israel-US conflict (and any escalating world events). Aggregates 200+ RSS sources across every perspective — US/Western, Israeli, Iranian state, Iranian independent/local, Arab Gulf states, Kurdish, Russian, Chinese, South Asian, and independent/OSINT outlets — into a single chronological live feed.

**Core problem it solves:** You should not have to visit 50 news websites to follow a fast-moving war. Everything comes to you, labeled by source and perspective, in real time.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend + API routes | SvelteKit (latest) | Fast, clean, SSR + serverless routes |
| Styling | Tailwind CSS (latest) | Utility-first, fast to build dark dense UIs |
| Database | Supabase Postgres | Free tier, built-in Realtime |
| Realtime | Supabase Realtime | WebSocket push on DB insert, no SSE infra needed |
| Hosting | Vercel | Free tier, cron jobs, SvelteKit adapter |
| RSS parsing | `rss-parser` (npm) | Battle-tested, handles malformed feeds |

---

## Architecture

```
Vercel Cron Job (every 60s)
  → POST /api/cron
  → Fetches all RSS feeds in parallel (batched ~50/group)
  → Parses with rss-parser
  → Upserts to Supabase articles table (ON CONFLICT guid DO NOTHING)
  → Returns 200

Supabase Realtime
  → Watches INSERT events on articles table
  → Broadcasts to all connected clients via WebSocket

SvelteKit Client
  → Initial load: fetch 200 most recent articles from Supabase
  → Subscribe to Supabase Realtime channel
  → New article inserted → prepended to feed with animation
  → Auto-pauses prepending if user has scrolled down (scroll position preserved)
```

---

## Database Schema

**Table: `articles`** (Supabase project: `qusjbpknlduuklnfciws`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, auto-generated |
| `guid` | text UNIQUE | From RSS item guid/link — deduplication key |
| `title` | text | Headline |
| `url` | text | Link to original article |
| `summary` | text | RSS description/excerpt |
| `published_at` | timestamptz | Original publish time from feed |
| `fetched_at` | timestamptz | When we ingested it (default now()) |
| `source_name` | text | e.g. "Reuters", "Fars News" |
| `source_region` | text | e.g. "US/Western", "Iranian State", "Kurdish" |
| `source_lang` | text | "en", "fa", "ar", "he", "ru", "zh" |
| `feed_url` | text | Which feed URL it came from |

Indexes: `published_at DESC`, `fetched_at DESC`, `source_region`, `source_lang`
RLS: Public SELECT via anon/authenticated. Service role only for INSERT (bypasses RLS).
Realtime: Enabled via `supabase_realtime` publication.

---

## Source List (~200+ feeds)

### Perspective Groups + Color Tags

| Tag | Color | Examples |
|---|---|---|
| US/Western | Blue | Reuters, AP, BBC, NYT, CNN, Fox News, NPR |
| Israeli | Orange | Times of Israel, Haaretz, Jerusalem Post, Ynet, i24 |
| Iranian State | Red | Press TV, IRNA, Tasnim, Fars News, Mehr News |
| Iranian Independent | Amber | Iran International, Radio Farda, reformist Persian papers |
| Iranian Local (Persian) | Yellow | Hamshahri, Tabnak, Shargh, Etemad, IRNA provincial offices |
| Arab/Gulf | Teal | Al Jazeera, Al Arabiya, Arab News, Gulf News, Al-Monitor |
| Kurdish | Purple | Rudaw, Kurdistan 24, BasNews, NRT |
| Turkish | Slate | Daily Sabah, Hurriyet, Anadolu Agency, TRT World |
| Russian | Rose | TASS, RT, Sputnik, Meduza, Moscow Times |
| Chinese | Cyan | Xinhua, Global Times, China Daily, CGTN |
| South Asian | Green | Dawn, Geo News, The Hindu, Times of India |
| Independent/OSINT | Gray | Bellingcat, +972, Mondoweiss, The Cradle, War on the Rocks |

Full source list with URLs to be maintained in `src/lib/feeds.ts`.

---

## UI Design

**Theme:** Dark. Dense. War room feel.

**Layout:**
- Top bar: Site title + live indicator (pulsing dot) + filter controls
- Filter bar: Perspective tags (toggle on/off), language filter, search
- Feed: Full-width chronological stream, newest at top
- Each article card:
  - Perspective color tag (left border or chip)
  - Source name + language flag if non-English
  - Relative timestamp ("2 min ago") + absolute on hover
  - Headline (large, readable)
  - Excerpt (2-3 lines, muted)
  - Link to original (opens new tab)
- New articles slide in at top with subtle fade animation
- "Pause" behavior: if user scrolls down >200px, new articles queue silently with a "X new articles" banner at top — click to jump back and flush queue

---

## Cron / Polling Strategy

Vercel free tier serverless function timeout: 10 seconds.
200+ feeds cannot all be fetched sequentially in 10s.

**Solution: Parallel fetch with Promise.allSettled()**
- All feeds fetched simultaneously with `Promise.allSettled()`
- Each fetch has a 8s individual timeout (AbortController)
- Slow/dead feeds fail silently — logged but don't block others
- Upsert uses `ON CONFLICT (guid) DO NOTHING` — safe to re-run

If 10s proves too tight on Vercel free tier: split into 4 cron endpoints (50 feeds each), each fires at :00, :15, :30, :45 seconds via Vercel cron.

---

## Environment Variables

```
SUPABASE_URL=https://qusjbpknlduuklnfciws.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key — server only>
PUBLIC_SUPABASE_URL=https://qusjbpknlduuklnfciws.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<anon key — public, safe for client>
CRON_SECRET=<random string to authenticate cron endpoint>
```

---

## What's Out of Scope (MVP)

- X/Twitter world leader tweets (API cost)
- Casualty tracker (manual data, future phase)
- Country involvement ranking (future phase)
- Article translation (future phase)
- Search (future phase — Supabase full-text search is easy to add)
- User accounts / bookmarks

---

## Success Criteria

The MVP works when:
1. You open the site and see a live stream of articles from 100+ sources
2. New articles appear within ~90 seconds of being published
3. You can filter by perspective (US/Iranian/Israeli/Arab/etc.)
4. Every article is clearly labeled with its source and perspective
5. The feed works on mobile
