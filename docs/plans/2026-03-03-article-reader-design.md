# Article Reader Panel — Design Document
*2026-03-03*

## Overview

In-website article reader that slides in from the right when a user clicks any article card. The feed remains visible behind it. Opens instantly with RSS summary + shimmer, then swaps in full article content fetched server-side.

---

## Architecture

### New: `GET /api/reader?url=...`
SvelteKit server route. Fetches the article URL server-side (bypasses CORS), parses with `linkedom`, extracts content with `@mozilla/readability`. Returns:
```json
{ "title": "...", "byline": "...", "content": "<p>...</p>", "siteName": "..." }
```
Or on failure:
```json
{ "error": "fetch_failed" | "parse_failed" | "paywall" }
```
Timeout: 8s. No caching needed (on-demand).

### New: `src/lib/components/ArticlePanel.svelte`
Fixed-position slide-in panel. Props: `article: Article | null`. When `article` is set, panel slides in and triggers fetch to `/api/reader`.

### Modified: `src/lib/components/ArticleCard.svelte`
`onclick` dispatches `select` event with article instead of navigating to `article.url`.

### Modified: `src/lib/components/ClusterCard.svelte`
Same — card click dispatches `select` event. "Read original →" link remains for external navigation.

### Modified: `src/routes/+page.svelte`
Adds `selectedArticle: Article | null = $state(null)`. Listens for `select` events from cards. Renders `<ArticlePanel>`.

---

## Panel UI

**Dimensions:** Fixed right edge, full height, `w-full` on mobile, `w-[45%]` on `md:`, `w-[38%]` on `lg:`.

**Slide transition:** `transform translateX(100%)` → `translateX(0)` on open. CSS transition, 200ms ease-out.

**Backdrop:** Semi-transparent dark overlay covering the feed (`bg-black/40`). Click to close.

**Top bar:**
- Region color chip (matching existing `REGION_COLORS`)
- Source name
- Relative timestamp
- "Read original →" link (always present, opens new tab)
- `✕` close button

**Loading state (shimmer):**
Skeleton blocks in `bg-gray-800` with sweeping `bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800` animation. Mimics: one wide title bar + 4–5 paragraph lines at varying widths.

**Loaded state:**
Full article content rendered via `{@html content}`. Prose styles: `text-gray-200` body, `text-white` headings, comfortable `leading-relaxed`, `max-w-prose`.

**Fallback state:**
On fetch error: shimmer dissolves, RSS summary shown, prominent "Full article unavailable — read original →" link.

**Keyboard:** `Escape` closes panel.

---

## Dependencies

- `@mozilla/readability` — battle-tested content extraction (same as Firefox Reader Mode)
- `linkedom` — lightweight server-side DOM implementation (avoids `jsdom` overhead on Vercel)

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Fetch timeout (8s) | Show fallback with RSS summary |
| Site blocks server fetch (403/429) | Show fallback |
| JS-rendered site (empty body) | Readability returns null → show fallback |
| Paywall (truncated content) | Show what was extracted + "Read original" |
| No summary in DB | Show title only in fallback |

---

## Out of Scope

- Caching fetched articles (not needed for MVP)
- Saving/bookmarking articles
- Font size controls
- Translation
