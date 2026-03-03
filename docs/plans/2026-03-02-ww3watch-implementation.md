# WW3Watch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a public real-time news aggregator pulling 200+ RSS feeds across all geopolitical perspectives into a single live chronological feed.

**Architecture:** SvelteKit 2 (Svelte 5) on Vercel. A cron-triggered server route fetches all RSS feeds in parallel every 60 seconds, upserts new articles to Supabase, and Supabase Realtime pushes inserts to all connected browser clients instantly.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Tailwind CSS v4, `@sveltejs/adapter-vercel`, `@supabase/supabase-js` v2, `rss-parser`, Vitest

---

## Pre-flight: What already exists

- `D:/Code/ww3watch/` — project root (git not yet initialized)
- `docs/plans/` — design doc already here
- Supabase project `qusjbpknlduuklnfciws` (us-east-2) — `articles` table already migrated, Realtime enabled, RLS enabled (public SELECT, service role INSERT)

---

## Task 1: Scaffold SvelteKit project

**Files:**
- Creates: all SvelteKit scaffolding in `D:/Code/ww3watch/`

**Step 1: Scaffold in existing directory**

```bash
cd D:/Code/ww3watch
npx sv create .
```

When prompted:
- Template → **SvelteKit minimal**
- Type checking → **Yes, using TypeScript syntax**
- Add-ons → select **vitest** (use spacebar), nothing else
- Package manager → **npm**

Expected: project files created, git initialized, `npm install` run automatically.

**Step 2: Install all dependencies**

```bash
npm install @supabase/supabase-js rss-parser
npm install -D tailwindcss @tailwindcss/vite @sveltejs/adapter-vercel
```

**Step 3: Verify dev server starts**

```bash
npm run dev
```

Expected: server at `http://localhost:5173`, no errors.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold SvelteKit project with Vitest"
```

---

## Task 2: Configure Tailwind v4 + dark theme base

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/app.css`
- Modify: `src/app.html`

**Step 1: Wire Tailwind into Vite**

Replace `vite.config.ts` entirely:

```typescript
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()]
})
```

**Step 2: Replace app.css with Tailwind import + dark base**

Replace `src/app.css` entirely:

```css
@import "tailwindcss";

@layer base {
  html {
    background-color: #0a0a0b;
    color: #e5e7eb;
  }

  * {
    box-sizing: border-box;
  }

  ::-webkit-scrollbar {
    width: 6px;
  }

  ::-webkit-scrollbar-track {
    background: #111113;
  }

  ::-webkit-scrollbar-thumb {
    background: #374151;
    border-radius: 3px;
  }
}
```

**Step 3: Add dark class + import to app.html**

In `src/app.html`, change `<html lang="en">` to `<html lang="en" class="dark">` and ensure `%sveltekit.head%` includes the css import. The `+layout.svelte` will import app.css.

**Step 4: Create layout that imports app.css**

Replace `src/routes/+layout.svelte`:

```svelte
<script>
  import '../app.css'
  let { children } = $props()
</script>

{@render children()}
```

**Step 5: Verify Tailwind works**

In `src/routes/+page.svelte`, temporarily add `<p class="text-red-500 text-2xl">Tailwind works</p>`, run `npm run dev`, verify red text appears. Then revert.

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: configure Tailwind v4 with dark base styles"
```

---

## Task 3: Configure Vercel adapter + vercel.json cron

**Files:**
- Modify: `svelte.config.js`
- Create: `vercel.json`

**Step 1: Switch to Vercel adapter**

Replace `svelte.config.js`:

```javascript
import adapter from '@sveltejs/adapter-vercel'
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter()
  }
}

export default config
```

**Step 2: Create vercel.json with cron**

Create `vercel.json` at project root:

```json
{
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "* * * * *"
    }
  ]
}
```

This fires every 60 seconds. Vercel free tier supports this.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: configure Vercel adapter and cron schedule"
```

---

## Task 4: Environment variables

**Files:**
- Create: `.env.local` (gitignored)
- Create: `.env.example`

**Step 1: Get Supabase keys**

From the Supabase dashboard for project `qusjbpknlduuklnfciws`:
- Go to **Settings → API**
- Copy **Project URL**, **anon public key**, and **service_role secret key**

**Step 2: Create .env.local**

```bash
# .env.local — never commit this file
SUPABASE_URL=https://qusjbpknlduuklnfciws.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your service_role key>
PUBLIC_SUPABASE_URL=https://qusjbpknlduuklnfciws.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<your anon key>
CRON_SECRET=<generate a random 32-char string, e.g. openssl rand -hex 16>
```

**Step 3: Create .env.example (committed)**

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
CRON_SECRET=your_random_secret_here
```

**Step 4: Verify .env.local is gitignored**

`.env.local` should already be in SvelteKit's default `.gitignore`. Confirm with `cat .gitignore | grep env`.

**Step 5: Commit**

```bash
git add .env.example
git commit -m "chore: add environment variable template"
```

---

## Task 5: Types and Supabase client utilities

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/supabase.ts` (browser client)
- Create: `src/lib/server/supabase.ts` (server-only client)

**Step 1: Create types.ts**

```typescript
// src/lib/types.ts

export type SourceRegion =
  | 'US/Western'
  | 'UK'
  | 'European'
  | 'Israeli'
  | 'Iranian State'
  | 'Iranian Independent'
  | 'Iranian Local'
  | 'Arab/Gulf'
  | 'Kurdish'
  | 'Turkish'
  | 'Russian'
  | 'Chinese'
  | 'South Asian'
  | 'Independent/OSINT'

export interface Article {
  id: string
  guid: string
  title: string
  url: string
  summary: string | null
  published_at: string | null
  fetched_at: string
  source_name: string
  source_region: SourceRegion
  source_lang: string
  feed_url: string
}

export interface Feed {
  name: string
  url: string
  region: SourceRegion
  lang: string
}

export const REGION_COLORS: Record<SourceRegion, string> = {
  'US/Western':          'bg-blue-600 text-white',
  'UK':                  'bg-blue-400 text-white',
  'European':            'bg-indigo-500 text-white',
  'Israeli':             'bg-orange-500 text-white',
  'Iranian State':       'bg-red-700 text-white',
  'Iranian Independent': 'bg-amber-500 text-black',
  'Iranian Local':       'bg-yellow-400 text-black',
  'Arab/Gulf':           'bg-teal-600 text-white',
  'Kurdish':             'bg-purple-600 text-white',
  'Turkish':             'bg-slate-500 text-white',
  'Russian':             'bg-rose-700 text-white',
  'Chinese':             'bg-red-500 text-white',
  'South Asian':         'bg-emerald-600 text-white',
  'Independent/OSINT':   'bg-gray-600 text-white',
}

export const REGION_BORDER: Record<SourceRegion, string> = {
  'US/Western':          'border-blue-600',
  'UK':                  'border-blue-400',
  'European':            'border-indigo-500',
  'Israeli':             'border-orange-500',
  'Iranian State':       'border-red-700',
  'Iranian Independent': 'border-amber-500',
  'Iranian Local':       'border-yellow-400',
  'Arab/Gulf':           'border-teal-600',
  'Kurdish':             'border-purple-600',
  'Turkish':             'border-slate-500',
  'Russian':             'border-rose-700',
  'Chinese':             'border-red-500',
  'South Asian':         'border-emerald-600',
  'Independent/OSINT':   'border-gray-600',
}
```

**Step 2: Create browser Supabase client**

```typescript
// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

export const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
```

**Step 3: Create server-only Supabase client**

```typescript
// src/lib/server/supabase.ts
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'

// Service role client — server only, never expose to browser
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})
```

**Step 4: Verify TypeScript is happy**

```bash
npm run check
```

Expected: no errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add types and Supabase client utilities"
```

---

## Task 6: Feeds list (feeds.ts)

**Files:**
- Create: `src/lib/feeds.ts`

This is the core editorial data. Every source gets `name`, `url`, `region`, `lang`.

**Step 1: Create feeds.ts**

```typescript
// src/lib/feeds.ts
import type { Feed } from './types'

export const FEEDS: Feed[] = [
  // ── US / WESTERN ────────────────────────────────────────────────
  { name: 'Reuters',            url: 'https://feeds.reuters.com/reuters/worldNews',                              region: 'US/Western', lang: 'en' },
  { name: 'AP News',            url: 'https://rsshub.app/apnews/topics/ap-top-news',                            region: 'US/Western', lang: 'en' },
  { name: 'NPR World',          url: 'https://feeds.npr.org/1004/rss.xml',                                      region: 'US/Western', lang: 'en' },
  { name: 'CNN World',          url: 'http://rss.cnn.com/rss/edition_world.rss',                                region: 'US/Western', lang: 'en' },
  { name: 'Fox News World',     url: 'https://moxie.foxnews.com/google-publisher/world.xml',                    region: 'US/Western', lang: 'en' },
  { name: 'New York Times',     url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',                  region: 'US/Western', lang: 'en' },
  { name: 'Washington Post',    url: 'https://feeds.washingtonpost.com/rss/world',                              region: 'US/Western', lang: 'en' },
  { name: 'NBC News',           url: 'https://feeds.nbcnews.com/nbcnews/public/world',                          region: 'US/Western', lang: 'en' },
  { name: 'ABC News',           url: 'https://abcnews.go.com/abcnews/internationalheadlines',                   region: 'US/Western', lang: 'en' },
  { name: 'CBS News',           url: 'https://www.cbsnews.com/latest/rss/world',                                region: 'US/Western', lang: 'en' },
  { name: 'The Hill',           url: 'https://thehill.com/feed/',                                               region: 'US/Western', lang: 'en' },
  { name: 'Axios',              url: 'https://api.axios.com/feed/',                                             region: 'US/Western', lang: 'en' },
  { name: 'Voice of America',   url: 'https://www.voanews.com/api/ztrqtqpym/rss.xml',                          region: 'US/Western', lang: 'en' },
  { name: 'Radio Free Europe',  url: 'https://www.rferl.org/api/zmpiqormvy/rss.xml',                           region: 'US/Western', lang: 'en' },
  { name: 'UPI',                url: 'https://rss.upi.com/news/world-news.rss',                                 region: 'US/Western', lang: 'en' },
  { name: 'Foreign Policy',     url: 'https://foreignpolicy.com/feed/',                                         region: 'US/Western', lang: 'en' },
  { name: 'The Intercept',      url: 'https://theintercept.com/feed/?rss',                                      region: 'US/Western', lang: 'en' },

  // ── UK ───────────────────────────────────────────────────────────
  { name: 'BBC World',          url: 'https://feeds.bbci.co.uk/news/world/rss.xml',                             region: 'UK', lang: 'en' },
  { name: 'The Guardian',       url: 'https://www.theguardian.com/world/rss',                                   region: 'UK', lang: 'en' },
  { name: 'Sky News',           url: 'https://feeds.skynews.com/feeds/rss/world.xml',                           region: 'UK', lang: 'en' },
  { name: 'The Independent',    url: 'https://www.independent.co.uk/news/world/rss',                            region: 'UK', lang: 'en' },
  { name: 'The Economist',      url: 'https://www.economist.com/the-world-this-week/rss.xml',                   region: 'UK', lang: 'en' },
  { name: 'Middle East Eye',    url: 'https://www.middleeasteye.net/rss',                                       region: 'UK', lang: 'en' },

  // ── EUROPEAN ─────────────────────────────────────────────────────
  { name: 'Deutsche Welle',     url: 'https://rss.dw.com/rdf/rss-en-world',                                    region: 'European', lang: 'en' },
  { name: 'France 24',          url: 'https://www.france24.com/en/rss',                                         region: 'European', lang: 'en' },
  { name: 'Euronews',           url: 'https://www.euronews.com/rss',                                            region: 'European', lang: 'en' },
  { name: 'RFI English',        url: 'https://www.rfi.fr/en/rss',                                               region: 'European', lang: 'en' },
  { name: 'Swiss Info',         url: 'https://www.swissinfo.ch/eng/rss/world',                                  region: 'European', lang: 'en' },
  { name: 'Der Spiegel',        url: 'https://www.spiegel.de/international/index.rss',                          region: 'European', lang: 'en' },

  // ── ISRAELI ──────────────────────────────────────────────────────
  { name: 'Times of Israel',    url: 'https://www.timesofisrael.com/feed/',                                     region: 'Israeli', lang: 'en' },
  { name: 'Jerusalem Post',     url: 'https://www.jpost.com/Rss/RssFeedsHeadlines.aspx',                       region: 'Israeli', lang: 'en' },
  { name: 'Haaretz',            url: 'https://www.haaretz.com/cmlink/1.628765',                                 region: 'Israeli', lang: 'en' },
  { name: 'Ynet News',          url: 'https://www.ynet.co.il/Integration/StoryRss2.xml',                       region: 'Israeli', lang: 'en' },
  { name: 'i24 News',           url: 'https://www.i24news.tv/en/rss',                                           region: 'Israeli', lang: 'en' },
  { name: 'Arutz Sheva',        url: 'https://www.israelnationalnews.com/Rss.aspx/News',                       region: 'Israeli', lang: 'en' },
  { name: 'Israel Hayom',       url: 'https://www.israelhayom.com/feed/',                                       region: 'Israeli', lang: 'en' },
  { name: 'Globes',             url: 'https://en.globes.co.il/en/rss',                                          region: 'Israeli', lang: 'en' },

  // ── IRANIAN STATE (ENGLISH) ───────────────────────────────────────
  { name: 'Press TV',           url: 'https://www.presstv.ir/homepagerss.aspx',                                 region: 'Iranian State', lang: 'en' },
  { name: 'IRNA',               url: 'https://en.irna.ir/rss',                                                  region: 'Iranian State', lang: 'en' },
  { name: 'Tasnim News',        url: 'https://www.tasnimnews.com/en/rss',                                       region: 'Iranian State', lang: 'en' },
  { name: 'Fars News',          url: 'https://www.farsnews.ir/rss',                                             region: 'Iranian State', lang: 'en' },
  { name: 'Mehr News',          url: 'https://en.mehrnews.com/rss',                                             region: 'Iranian State', lang: 'en' },
  { name: 'Tehran Times',       url: 'https://www.tehrantimes.com/rss',                                         region: 'Iranian State', lang: 'en' },
  { name: 'ISNA English',       url: 'https://en.isna.ir/rss',                                                  region: 'Iranian State', lang: 'en' },
  { name: 'Iran Daily',         url: 'https://www.iran-daily.com/rss',                                          region: 'Iranian State', lang: 'en' },
  { name: 'Financial Tribune',  url: 'https://financialtribune.com/rss',                                        region: 'Iranian State', lang: 'en' },

  // ── IRANIAN INDEPENDENT ───────────────────────────────────────────
  { name: 'Iran International', url: 'https://www.iranintl.com/en/rss',                                        region: 'Iranian Independent', lang: 'en' },
  { name: 'Radio Farda',        url: 'https://www.radiofarda.com/api/ztrqtqpym/rss.xml',                       region: 'Iranian Independent', lang: 'en' },

  // ── IRANIAN LOCAL (PERSIAN) ──────────────────────────────────────
  { name: 'Hamshahri',          url: 'https://www.hamshahrionline.ir/rss',                                      region: 'Iranian Local', lang: 'fa' },
  { name: 'Khabar Online',      url: 'https://www.khabaronline.ir/rss',                                         region: 'Iranian Local', lang: 'fa' },
  { name: 'ISNA Persian',       url: 'https://isna.ir/rss',                                                     region: 'Iranian Local', lang: 'fa' },
  { name: 'Tabnak',             url: 'https://www.tabnak.ir/fa/rss',                                            region: 'Iranian Local', lang: 'fa' },
  { name: 'Mashregh News',      url: 'https://www.mashreghnews.ir/rss',                                         region: 'Iranian Local', lang: 'fa' },
  { name: 'Entekhab',           url: 'https://www.entekhab.ir/rss',                                             region: 'Iranian Local', lang: 'fa' },
  { name: 'Alef News',          url: 'https://www.alef.ir/rss.xml',                                             region: 'Iranian Local', lang: 'fa' },
  { name: 'Shargh Daily',       url: 'https://sharghdaily.com/rss',                                             region: 'Iranian Local', lang: 'fa' },
  { name: 'Aftab News',         url: 'https://www.aftabnews.ir/rss',                                            region: 'Iranian Local', lang: 'fa' },
  { name: 'Donya-e-Eqtesad',    url: 'https://donya-e-eqtesad.com/rss',                                        region: 'Iranian Local', lang: 'fa' },
  { name: 'Jahan News',         url: 'https://www.jahannews.com/rss',                                           region: 'Iranian Local', lang: 'fa' },
  { name: 'Raja News',          url: 'https://www.rajanews.com/rss',                                            region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Isfahan',       url: 'https://www.irna.ir/rss/taglist/84001',                                   region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Khorasan',      url: 'https://www.irna.ir/rss/taglist/84008',                                   region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Khuzestan',     url: 'https://www.irna.ir/rss/taglist/84011',                                   region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Kermanshah',    url: 'https://www.irna.ir/rss/taglist/84013',                                   region: 'Iranian Local', lang: 'fa' },
  { name: 'IRNA Fars',          url: 'https://www.irna.ir/rss/taglist/84004',                                   region: 'Iranian Local', lang: 'fa' },

  // ── ARAB / GULF ───────────────────────────────────────────────────
  { name: 'Al Jazeera English', url: 'https://www.aljazeera.com/xml/rss/all.xml',                              region: 'Arab/Gulf', lang: 'en' },
  { name: 'Al Jazeera Arabic',  url: 'https://www.aljazeera.net/aljazeerarss/a2/a2.xml',                       region: 'Arab/Gulf', lang: 'ar' },
  { name: 'Al Arabiya English', url: 'https://english.alarabiya.net/rss',                                       region: 'Arab/Gulf', lang: 'en' },
  { name: 'Arab News',          url: 'https://www.arabnews.com/rss.xml',                                        region: 'Arab/Gulf', lang: 'en' },
  { name: 'Saudi Gazette',      url: 'https://saudigazette.com.sa/rss',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'Gulf News',          url: 'https://gulfnews.com/rss',                                                region: 'Arab/Gulf', lang: 'en' },
  { name: 'The National (UAE)', url: 'https://www.thenationalnews.com/rss',                                     region: 'Arab/Gulf', lang: 'en' },
  { name: 'Khaleej Times',      url: 'https://www.khaleejtimes.com/rss.xml',                                    region: 'Arab/Gulf', lang: 'en' },
  { name: 'KUNA',               url: 'https://www.kuna.net.kw/rss',                                             region: 'Arab/Gulf', lang: 'en' },
  { name: 'Kuwait Times',       url: 'https://www.kuwaittimes.com/feed/',                                       region: 'Arab/Gulf', lang: 'en' },
  { name: 'Qatar News Agency',  url: 'https://www.qna.org.qa/en/rss',                                          region: 'Arab/Gulf', lang: 'en' },
  { name: 'The Peninsula',      url: 'https://www.thepeninsulaqatar.com/rss',                                   region: 'Arab/Gulf', lang: 'en' },
  { name: 'Bahrain News Agency',url: 'https://www.bna.bh/en/rss',                                              region: 'Arab/Gulf', lang: 'en' },
  { name: 'Oman News Agency',   url: 'https://omannews.gov.om/rss',                                             region: 'Arab/Gulf', lang: 'en' },
  { name: 'Jordan Times',       url: 'https://www.jordantimes.com/rss/',                                        region: 'Arab/Gulf', lang: 'en' },
  { name: 'Naharnet',           url: 'https://www.naharnet.com/stories/en/rss',                                 region: 'Arab/Gulf', lang: 'en' },
  { name: "L'Orient Today",     url: 'https://www.lorientlejour.com/rss',                                       region: 'Arab/Gulf', lang: 'en' },
  { name: 'SANA (Syria)',        url: 'https://sana.sy/en/?feed=rss2',                                          region: 'Arab/Gulf', lang: 'en' },
  { name: 'Shafaq News',        url: 'https://shafaq.com/en/rss',                                               region: 'Arab/Gulf', lang: 'en' },
  { name: 'Iraqi News',         url: 'https://www.iraqinews.com/feed/',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'Asharq Al-Awsat',    url: 'https://english.aawsat.com/rss',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'Middle East Monitor',url: 'https://www.middleeastmonitor.com/feed/',                                 region: 'Arab/Gulf', lang: 'en' },
  { name: 'Al-Monitor',         url: 'https://www.al-monitor.com/rss',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'The New Arab',       url: 'https://www.newarab.com/rss.xml',                                         region: 'Arab/Gulf', lang: 'en' },
  { name: 'Mada Masr (Egypt)',  url: 'https://www.madamasr.com/en/feed/',                                       region: 'Arab/Gulf', lang: 'en' },
  { name: 'Al-Ahram',           url: 'https://english.ahram.org.eg/rss.aspx/NewsContentID/2.aspx',             region: 'Arab/Gulf', lang: 'en' },

  // ── KURDISH ───────────────────────────────────────────────────────
  { name: 'Rudaw',              url: 'https://www.rudaw.net/english/rss',                                       region: 'Kurdish', lang: 'en' },
  { name: 'Kurdistan 24',       url: 'https://www.kurdistan24.net/en/rss',                                      region: 'Kurdish', lang: 'en' },
  { name: 'BasNews',            url: 'https://www.basnews.com/en/rss',                                          region: 'Kurdish', lang: 'en' },
  { name: 'NRT Digital',        url: 'https://www.nrttv.com/en/rss',                                            region: 'Kurdish', lang: 'en' },

  // ── TURKISH ───────────────────────────────────────────────────────
  { name: 'Daily Sabah',        url: 'https://www.dailysabah.com/rss',                                          region: 'Turkish', lang: 'en' },
  { name: 'Hurriyet Daily',     url: 'https://www.hurriyetdailynews.com/rss',                                   region: 'Turkish', lang: 'en' },
  { name: 'Anadolu Agency',     url: 'https://www.aa.com.tr/en/rss/default',                                    region: 'Turkish', lang: 'en' },
  { name: 'TRT World',          url: 'https://www.trtworld.com/rss',                                            region: 'Turkish', lang: 'en' },

  // ── RUSSIAN ───────────────────────────────────────────────────────
  { name: 'TASS',               url: 'https://tass.com/rss/v2.xml',                                             region: 'Russian', lang: 'en' },
  { name: 'RT',                 url: 'https://www.rt.com/rss/',                                                  region: 'Russian', lang: 'en' },
  { name: 'Sputnik',            url: 'https://sputniknews.com/export/rss2/world/index.xml',                     region: 'Russian', lang: 'en' },
  { name: 'Meduza',             url: 'https://meduza.io/en/rss/all',                                            region: 'Russian', lang: 'en' },
  { name: 'The Moscow Times',   url: 'https://www.themoscowtimes.com/rss',                                      region: 'Russian', lang: 'en' },

  // ── CHINESE ───────────────────────────────────────────────────────
  { name: 'Xinhua',             url: 'http://www.xinhuanet.com/english/rss/worldrss.xml',                       region: 'Chinese', lang: 'en' },
  { name: 'Global Times',       url: 'https://www.globaltimes.cn/rss/outbrain.xml',                             region: 'Chinese', lang: 'en' },
  { name: 'China Daily',        url: 'https://www.chinadaily.com.cn/rss/world_rss.xml',                         region: 'Chinese', lang: 'en' },
  { name: 'CGTN',               url: 'https://www.cgtn.com/subscribe/rss/section/world-news.do',                region: 'Chinese', lang: 'en' },
  { name: 'South China Morning Post', url: 'https://www.scmp.com/rss/91/feed',                                  region: 'Chinese', lang: 'en' },

  // ── SOUTH ASIAN ───────────────────────────────────────────────────
  { name: 'Dawn (Pakistan)',    url: 'https://www.dawn.com/feeds/home',                                         region: 'South Asian', lang: 'en' },
  { name: 'Geo News',           url: 'https://www.geo.tv/rss/1',                                                region: 'South Asian', lang: 'en' },
  { name: 'The News Intl',      url: 'https://www.thenews.com.pk/rss/1/1',                                      region: 'South Asian', lang: 'en' },
  { name: 'The Hindu',          url: 'https://www.thehindu.com/news/international/?service=rss',                region: 'South Asian', lang: 'en' },
  { name: 'Times of India',     url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms',              region: 'South Asian', lang: 'en' },
  { name: 'NHK World',          url: 'https://www3.nhk.or.jp/nhkworld/en/news/feeds/rss.xml',                  region: 'South Asian', lang: 'en' },

  // ── INDEPENDENT / OSINT ───────────────────────────────────────────
  { name: 'Bellingcat',         url: 'https://www.bellingcat.com/feed/',                                        region: 'Independent/OSINT', lang: 'en' },
  { name: 'The Cradle',         url: 'https://thecradle.co/rss.xml',                                           region: 'Independent/OSINT', lang: 'en' },
  { name: 'Mondoweiss',         url: 'https://mondoweiss.net/feed/',                                            region: 'Independent/OSINT', lang: 'en' },
  { name: 'Electronic Intifada',url: 'https://electronicintifada.net/feeds/news',                               region: 'Independent/OSINT', lang: 'en' },
  { name: '+972 Magazine',      url: 'https://www.972mag.com/feed/',                                            region: 'Independent/OSINT', lang: 'en' },
  { name: 'War on the Rocks',   url: 'https://warontherocks.com/feed/',                                         region: 'Independent/OSINT', lang: 'en' },
  { name: 'Responsible Statecraft', url: 'https://responsiblestatecraft.org/feed/',                             region: 'Independent/OSINT', lang: 'en' },
  { name: 'The Grayzone',       url: 'https://thegrayzone.com/feed/',                                           region: 'Independent/OSINT', lang: 'en' },
  { name: 'CFR',                url: 'https://www.cfr.org/rss',                                                 region: 'Independent/OSINT', lang: 'en' },
  { name: 'Lawfare',            url: 'https://www.lawfaremedia.org/feed/',                                      region: 'Independent/OSINT', lang: 'en' },
]
```

**Step 2: Commit**

```bash
git add src/lib/feeds.ts
git commit -m "feat: add complete RSS feed source list (120+ sources)"
```

---

## Task 7: RSS fetch utility (with tests)

**Files:**
- Create: `src/lib/server/rss.ts`
- Create: `src/lib/server/rss.test.ts`

**Step 1: Write failing tests first**

```typescript
// src/lib/server/rss.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchFeed, buildGuid } from './rss'

describe('buildGuid', () => {
  it('returns the item link if guid is missing', () => {
    expect(buildGuid({ link: 'https://example.com/article' })).toBe('https://example.com/article')
  })

  it('returns guid if present', () => {
    expect(buildGuid({ guid: 'unique-123', link: 'https://example.com/article' })).toBe('unique-123')
  })

  it('returns empty string if both missing', () => {
    expect(buildGuid({})).toBe('')
  })
})

describe('fetchFeed', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns empty array on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network failure'))
    const result = await fetchFeed({ name: 'Test', url: 'https://fail.example.com', region: 'US/Western', lang: 'en' })
    expect(result).toEqual([])
  })

  it('returns empty array on timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      () => new Promise((_, reject) => setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 100))
    )
    const result = await fetchFeed({ name: 'Test', url: 'https://slow.example.com', region: 'US/Western', lang: 'en' })
    expect(result).toEqual([])
  })
})
```

**Step 2: Run tests to verify they fail**

```bash
npm run test -- src/lib/server/rss.test.ts
```

Expected: `Cannot find module './rss'`

**Step 3: Implement rss.ts**

```typescript
// src/lib/server/rss.ts
import Parser from 'rss-parser'
import type { Feed, Article, SourceRegion } from '../types'

const parser = new Parser({ timeout: 8000 })

export function buildGuid(item: { guid?: string; link?: string }): string {
  return item.guid ?? item.link ?? ''
}

export async function fetchFeed(feed: Feed): Promise<Omit<Article, 'id' | 'fetched_at'>[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WW3Watch/1.0 (news aggregator; +https://ww3watch.com)' }
    })

    clearTimeout(timer)

    if (!response.ok) return []

    const xml = await response.text()
    const parsed = await parser.parseString(xml)

    return parsed.items
      .filter(item => buildGuid(item) !== '')
      .map(item => ({
        guid:         buildGuid(item),
        title:        item.title?.trim() ?? '(no title)',
        url:          item.link ?? feed.url,
        summary:      item.contentSnippet?.slice(0, 500) ?? item.summary?.slice(0, 500) ?? null,
        published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        source_name:  feed.name,
        source_region: feed.region as SourceRegion,
        source_lang:  feed.lang,
        feed_url:     feed.url,
      }))
  } catch {
    clearTimeout(timer)
    return []
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npm run test -- src/lib/server/rss.test.ts
```

Expected: all 4 tests PASS.

**Step 5: Commit**

```bash
git add src/lib/server/rss.ts src/lib/server/rss.test.ts
git commit -m "feat: add RSS fetch utility with tests"
```

---

## Task 8: Cron API endpoint

**Files:**
- Create: `src/routes/api/cron/+server.ts`

**Step 1: Create the cron endpoint**

```typescript
// src/routes/api/cron/+server.ts
import { json } from '@sveltejs/kit'
import { CRON_SECRET } from '$env/static/private'
import { FEEDS } from '$lib/feeds'
import { fetchFeed } from '$lib/server/rss'
import { supabaseAdmin } from '$lib/server/supabase'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ request }) => {
  // Authenticate: Vercel sends Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Fetch all feeds in parallel — failures are swallowed per-feed
  const results = await Promise.allSettled(FEEDS.map(feed => fetchFeed(feed)))

  const articles = results
    .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchFeed>>> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(a => a.guid !== '')

  if (articles.length === 0) {
    return json({ inserted: 0, total: 0 })
  }

  // Upsert — ON CONFLICT (guid) DO NOTHING via ignoreDuplicates
  const { error, count } = await supabaseAdmin
    .from('articles')
    .upsert(articles, { onConflict: 'guid', ignoreDuplicates: true })
    .select('id', { count: 'exact', head: true })

  if (error) {
    console.error('Supabase upsert error:', error)
    return json({ error: error.message }, { status: 500 })
  }

  return json({ inserted: count ?? 0, total: articles.length })
}
```

**Step 2: Test manually by running dev server and calling it**

```bash
npm run dev
# In a separate terminal:
curl -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)" \
  http://localhost:5173/api/cron
```

Expected: `{"inserted": <N>, "total": <M>}` where N and M are positive numbers.

Check Supabase dashboard → Table Editor → articles to confirm rows appeared.

**Step 3: Commit**

```bash
git add src/routes/api/cron/+server.ts
git commit -m "feat: add RSS cron endpoint with parallel fetch and Supabase upsert"
```

---

## Task 9: Main page server load + Supabase Realtime subscription

**Files:**
- Create: `src/routes/+page.server.ts`
- Create: `src/routes/+page.svelte` (initial version)

**Step 1: Create server load function**

```typescript
// src/routes/+page.server.ts
import { supabaseAdmin } from '$lib/server/supabase'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async () => {
  const { data: articles } = await supabaseAdmin
    .from('articles')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(500)

  return { articles: articles ?? [] }
}
```

**Step 2: Create initial +page.svelte with realtime wiring**

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import type { Article } from '$lib/types'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  let articles = $state<Article[]>(data.articles as Article[])
  let newQueue = $state<Article[]>([])
  let isPaused = $state(false)
  let scrollY = $state(0)

  // Pause if user scrolls down more than 300px
  $effect(() => {
    isPaused = scrollY > 300
  })

  // Flush queued articles when user scrolls back to top
  $effect(() => {
    if (!isPaused && newQueue.length > 0) {
      articles = [...newQueue, ...articles]
      newQueue = []
    }
  })

  onMount(() => {
    const channel = supabase
      .channel('articles')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'articles' },
        (payload) => {
          const article = payload.new as Article
          if (isPaused) {
            newQueue = [article, ...newQueue]
          } else {
            articles = [article, ...articles]
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  })
</script>

<svelte:window bind:scrollY />

<main class="min-h-screen bg-[#0a0a0b] text-gray-200">
  <p class="p-8 text-center text-gray-500">Loading feed... ({articles.length} articles)</p>
</main>
```

**Step 3: Verify page loads with articles**

```bash
npm run dev
```

Open `http://localhost:5173`. Should show article count from the initial cron test run.

**Step 4: Commit**

```bash
git add src/routes/+page.server.ts src/routes/+page.svelte
git commit -m "feat: wire server load and Supabase Realtime subscription"
```

---

## Task 10: ArticleCard component

**Files:**
- Create: `src/lib/components/ArticleCard.svelte`

**Step 1: Create ArticleCard**

```svelte
<!-- src/lib/components/ArticleCard.svelte -->
<script lang="ts">
  import type { Article } from '$lib/types'
  import { REGION_COLORS, REGION_BORDER } from '$lib/types'

  let { article }: { article: Article } = $props()

  function timeAgo(dateStr: string | null): string {
    if (!dateStr) return 'unknown time'
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  function langFlag(lang: string): string {
    const flags: Record<string, string> = {
      fa: '🇮🇷', ar: '🇸🇦', he: '🇮🇱', ru: '🇷🇺',
      zh: '🇨🇳', tr: '🇹🇷', fr: '🇫🇷', de: '🇩🇪', ur: '🇵🇰'
    }
    return flags[lang] ?? ''
  }
</script>

<article
  class="border-l-4 {REGION_BORDER[article.source_region]} bg-[#111113] hover:bg-[#18181b] transition-colors px-4 py-3 group"
>
  <div class="flex items-center gap-2 mb-1.5 flex-wrap">
    <span class="text-xs font-semibold px-2 py-0.5 rounded {REGION_COLORS[article.source_region]}">
      {article.source_region}
    </span>
    <span class="text-sm font-medium text-gray-300">
      {langFlag(article.source_lang)} {article.source_name}
    </span>
    <span class="text-xs text-gray-500 ml-auto" title={article.published_at ?? ''}>
      {timeAgo(article.published_at)}
    </span>
  </div>

  <a
    href={article.url}
    target="_blank"
    rel="noopener noreferrer"
    class="block text-white font-semibold leading-snug hover:text-blue-400 transition-colors mb-1"
  >
    {article.title}
  </a>

  {#if article.summary}
    <p class="text-sm text-gray-400 line-clamp-2">{article.summary}</p>
  {/if}
</article>
```

**Step 2: Commit**

```bash
git add src/lib/components/ArticleCard.svelte
git commit -m "feat: add ArticleCard component with perspective color coding"
```

---

## Task 11: FilterBar component

**Files:**
- Create: `src/lib/components/FilterBar.svelte`

**Step 1: Create FilterBar**

```svelte
<!-- src/lib/components/FilterBar.svelte -->
<script lang="ts">
  import type { SourceRegion } from '$lib/types'
  import { REGION_COLORS } from '$lib/types'

  let {
    activeRegions = $bindable<Set<SourceRegion>>(),
    searchQuery = $bindable<string>(),
  }: {
    activeRegions: Set<SourceRegion>
    searchQuery: string
  } = $props()

  const ALL_REGIONS: SourceRegion[] = [
    'US/Western', 'UK', 'European', 'Israeli',
    'Iranian State', 'Iranian Independent', 'Iranian Local',
    'Arab/Gulf', 'Kurdish', 'Turkish',
    'Russian', 'Chinese', 'South Asian', 'Independent/OSINT',
  ]

  function toggleRegion(region: SourceRegion) {
    const next = new Set(activeRegions)
    if (next.has(region)) {
      next.delete(region)
    } else {
      next.add(region)
    }
    activeRegions = next
  }

  function selectAll() {
    activeRegions = new Set(ALL_REGIONS)
  }

  function clearAll() {
    activeRegions = new Set()
  }
</script>

<div class="sticky top-0 z-10 bg-[#0a0a0b]/95 backdrop-blur border-b border-gray-800 px-4 py-3">
  <div class="max-w-3xl mx-auto space-y-2">
    <div class="flex items-center gap-2">
      <input
        type="text"
        placeholder="Search headlines..."
        bind:value={searchQuery}
        class="flex-1 bg-[#18181b] border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />
      <button onclick={selectAll} class="text-xs text-gray-400 hover:text-white px-2 py-1">All</button>
      <button onclick={clearAll} class="text-xs text-gray-400 hover:text-white px-2 py-1">None</button>
    </div>

    <div class="flex flex-wrap gap-1.5">
      {#each ALL_REGIONS as region}
        <button
          onclick={() => toggleRegion(region)}
          class="text-xs px-2 py-0.5 rounded font-medium transition-opacity {REGION_COLORS[region]} {activeRegions.has(region) ? 'opacity-100' : 'opacity-30'}"
        >
          {region}
        </button>
      {/each}
    </div>
  </div>
</div>
```

**Step 2: Commit**

```bash
git add src/lib/components/FilterBar.svelte
git commit -m "feat: add FilterBar with perspective toggles and search"
```

---

## Task 12: Wire up full page

**Files:**
- Modify: `src/routes/+page.svelte`

**Step 1: Replace +page.svelte with complete implementation**

```svelte
<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from '$lib/supabase'
  import type { Article, SourceRegion } from '$lib/types'
  import ArticleCard from '$lib/components/ArticleCard.svelte'
  import FilterBar from '$lib/components/FilterBar.svelte'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  let articles = $state<Article[]>(data.articles as Article[])
  let newQueue = $state<Article[]>([])
  let scrollY = $state(0)
  let searchQuery = $state('')
  let activeRegions = $state(new Set<SourceRegion>([
    'US/Western', 'UK', 'European', 'Israeli',
    'Iranian State', 'Iranian Independent', 'Iranian Local',
    'Arab/Gulf', 'Kurdish', 'Turkish',
    'Russian', 'Chinese', 'South Asian', 'Independent/OSINT',
  ]))

  let isPaused = $derived(scrollY > 300)

  let filtered = $derived(
    articles.filter(a => {
      const matchesRegion = activeRegions.has(a.source_region)
      const matchesSearch = searchQuery.trim() === '' ||
        a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.summary ?? '').toLowerCase().includes(searchQuery.toLowerCase())
      return matchesRegion && matchesSearch
    })
  )

  function flushQueue() {
    articles = [...newQueue, ...articles]
    newQueue = []
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  onMount(() => {
    const channel = supabase
      .channel('articles-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'articles' },
        (payload) => {
          const article = payload.new as Article
          if (isPaused) {
            newQueue = [article, ...newQueue]
          } else {
            articles = [article, ...articles]
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  })
</script>

<svelte:window bind:scrollY />

<div class="min-h-screen bg-[#0a0a0b]">
  <!-- Header -->
  <header class="border-b border-gray-800 px-4 py-3">
    <div class="max-w-3xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <h1 class="text-white font-bold text-lg tracking-tight">WW3Watch</h1>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          <span class="text-xs text-gray-400">LIVE</span>
        </div>
      </div>
      <span class="text-xs text-gray-500">{filtered.length.toLocaleString()} articles</span>
    </div>
  </header>

  <!-- Filter Bar -->
  <FilterBar bind:activeRegions bind:searchQuery />

  <!-- New articles banner -->
  {#if newQueue.length > 0}
    <div class="sticky top-[89px] z-10 flex justify-center py-2 pointer-events-none">
      <button
        onclick={flushQueue}
        class="pointer-events-auto bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-1.5 rounded-full shadow-lg transition-colors"
      >
        ↑ {newQueue.length} new {newQueue.length === 1 ? 'article' : 'articles'}
      </button>
    </div>
  {/if}

  <!-- Feed -->
  <main class="max-w-3xl mx-auto divide-y divide-gray-800/50 pb-20">
    {#if filtered.length === 0}
      <div class="py-20 text-center text-gray-500">
        {articles.length === 0 ? 'Loading articles...' : 'No articles match your filters.'}
      </div>
    {/if}

    {#each filtered as article (article.id)}
      <ArticleCard {article} />
    {/each}
  </main>
</div>
```

**Step 2: Run dev and verify full UI**

```bash
npm run dev
```

Open `http://localhost:5173`. Verify:
- Header with LIVE indicator
- Filter tags all active
- Articles displayed with correct color-coded region tags
- Search works
- If you scroll down, new articles queue in the banner

**Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: complete feed UI with filters, search, and live queue banner"
```

---

## Task 13: Run all tests

**Step 1: Run test suite**

```bash
npm run test
```

Expected: all tests pass (rss.test.ts). No failures.

**Step 2: Run type check**

```bash
npm run check
```

Expected: no TypeScript errors.

---

## Task 14: Deploy to Vercel

**Step 1: Create GitHub repo and push**

```bash
git remote add origin https://github.com/<your-username>/ww3watch.git
git push -u origin main
```

**Step 2: Import project on Vercel**

Go to `https://vercel.com/new`, import the GitHub repo, select **SvelteKit** framework preset.

**Step 3: Add environment variables in Vercel dashboard**

In Project Settings → Environment Variables, add all five from `.env.local`:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `CRON_SECRET`

**Step 4: Deploy**

Vercel will auto-deploy on push. Once deployed, verify:
- Site loads and shows articles
- Cron job fires every minute (check Vercel dashboard → Cron Jobs)
- New articles appear in the feed without page refresh

**Step 5: Final commit with deployment notes**

```bash
git tag v0.1.0
git push origin v0.1.0
```

---

## Known Feed Validation Needed

Some feed URLs may be dead or changed. After initial deployment:
1. Check Vercel function logs for fetch errors per feed
2. Dead feeds will silently return `[]` — check which sources are contributing zero articles
3. Replace dead URLs by searching `<source_name> RSS feed` for updated URLs

The most likely problem feeds: AP News (killed official RSS), Bloomberg (paywalled), some Persian local feeds.

---

## Next Phase (Post-MVP)

- Casualty tracker (manual Supabase table + admin UI)
- Country involvement ranking widget
- World leader posts panel (X embed or Nitter RSS bridge)
- Full-text search (Supabase `tsvector` column)
- Mobile-optimized layout tweaks
- Feed health dashboard (which sources are live)
