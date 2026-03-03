# Relevance Filtering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Filter out non-conflict articles from general Western news RSS feeds and upgrade 4 noisy feeds to conflict-specific sub-feeds.

**Architecture:** New `src/lib/relevance.ts` module exports `isRelevant(title, summary, lang)`. English articles must match at least one keyword from a ~150-term set (single words + phrases) covering conflict terms, key actors, and relevant geographies. Non-English articles pass through unconditionally — those sources are conflict-specific by nature. The cron endpoint applies the filter after fetching, before upsert. Four feeds (BBC, France 24, Guardian, DW) are swapped to their Middle East / conflict sub-feeds.

**Tech Stack:** SvelteKit, Vitest, TypeScript

---

### Task 1: Upgrade 4 feeds to conflict-specific sub-feeds

**Files:**
- Modify: `src/lib/feeds.ts`

**Step 1: Make the changes**

In `src/lib/feeds.ts`, make these 4 replacements:

| Line | Old URL | New URL |
|------|---------|---------|
| BBC World | `https://feeds.bbci.co.uk/news/world/rss.xml` | `https://feeds.bbci.co.uk/news/world/middle_east/rss.xml` |
| France 24 | `https://www.france24.com/en/rss` | `https://www.france24.com/en/middle-east/rss` |
| The Guardian | `https://www.theguardian.com/world/rss` | `https://www.theguardian.com/world/middleeast/rss` |
| Deutsche Welle | `https://rss.dw.com/rdf/rss-en-world` | `https://rss.dw.com/rdf/rss-en-middle-east` |

**Step 2: Verify type-check still passes**

Run: `npm run check`
Expected: 0 errors, 0 warnings

**Step 3: Commit**

```bash
git add src/lib/feeds.ts
git commit -m "feat: swap BBC/France24/Guardian/DW to conflict-specific sub-feeds"
```

---

### Task 2: Create relevance module with tests (TDD)

**Files:**
- Create: `src/lib/relevance.ts`
- Create: `src/lib/relevance.test.ts`

**Step 1: Write the failing tests first**

Create `src/lib/relevance.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isRelevant } from './relevance'

describe('isRelevant', () => {
  it('passes non-English articles unconditionally', () => {
    expect(isRelevant('گزارش روز تهران', '', 'fa')).toBe(true)
    expect(isRelevant('طقس اليوم في بغداد', '', 'ar')).toBe(true)
  })

  it('passes articles with direct conflict keywords', () => {
    expect(isRelevant('US airstrike kills 12 in Yemen', '', 'en')).toBe(true)
    expect(isRelevant('Israeli troops advance on Gaza', '', 'en')).toBe(true)
    expect(isRelevant('Russia fires missiles at Kyiv', '', 'en')).toBe(true)
  })

  it('passes articles with actor keywords', () => {
    expect(isRelevant('Iran warns of retaliation', '', 'en')).toBe(true)
    expect(isRelevant('Hezbollah launches rockets', '', 'en')).toBe(true)
    expect(isRelevant('Hamas releases statement', '', 'en')).toBe(true)
    expect(isRelevant('Houthis target Red Sea ship', '', 'en')).toBe(true)
  })

  it('passes articles with phrase keywords', () => {
    expect(isRelevant('North Korea tests ballistic missile', '', 'en')).toBe(true)
    expect(isRelevant('Tensions rise over Taiwan Strait', '', 'en')).toBe(true)
    expect(isRelevant('Regime change feared after coup', '', 'en')).toBe(true)
  })

  it('passes articles where keyword appears in summary not title', () => {
    expect(isRelevant('World leaders meet', 'Talks focus on Ukraine ceasefire', 'en')).toBe(true)
  })

  it('filters out irrelevant articles', () => {
    expect(isRelevant("Mexican drug lord 'El Mencho' buried in golden coffin", 'Nemesio Oseguera led the feared Jalisco New Generation Cartel', 'en')).toBe(false)
    expect(isRelevant('In Japan, support for the death penalty remains high', 'Japan is one of the few countries that still use the death penalty', 'en')).toBe(false)
    expect(isRelevant('Kim Jong Un fuels succession buzz with daughter leather jacket', 'Speculation is growing that his daughter may be named successor', 'en')).toBe(false)
    expect(isRelevant('Top 10 restaurants in Tokyo', '', 'en')).toBe(false)
    expect(isRelevant('New study links coffee to longevity', '', 'en')).toBe(false)
  })
})
```

**Step 2: Run tests — verify they all FAIL**

Run: `npm run test -- relevance`
Expected: all tests fail with "Cannot find module './relevance'"

**Step 3: Implement relevance.ts**

Create `src/lib/relevance.ts`:

```typescript
const SINGLE_KEYWORDS = new Set([
  // Direct conflict
  'war', 'warfare', 'warzone', 'combat', 'battle', 'fighting', 'clash', 'clashes',
  'military', 'troops', 'soldier', 'soldiers', 'forces', 'army', 'navy',
  'strike', 'airstrike', 'bombing', 'bomb', 'missile', 'rocket', 'drone',
  'attack', 'attacked', 'offensive', 'invasion', 'invaded', 'incursion', 'raid',
  'siege', 'blockade', 'occupation', 'occupied',
  'weapon', 'weapons', 'arms', 'artillery', 'warship',
  'casualty', 'casualties', 'killed', 'wounded', 'fatalities',
  'ceasefire', 'truce', 'armistice',
  'nuclear', 'warhead',
  'genocide', 'massacre',
  'hostage', 'captive',
  'escalation', 'escalate', 'escalating',
  'ultimatum',
  'refugee', 'displaced', 'evacuation',
  'terrorist', 'terrorism',
  'geopolitical', 'geopolitics',
  'coup', 'overthrow',
  'sanctions', 'sanction', 'embargo',
  'espionage', 'intelligence',
  // Key actors
  'iran', 'iranian', 'irgc',
  'israel', 'israeli', 'idf', 'mossad', 'netanyahu',
  'hamas', 'hezbollah',
  'houthi', 'houthis', 'ansarallah',
  'isis', 'isil', 'daesh',
  'wagner', 'pkk',
  'pentagon', 'centcom',
  'zelensky', 'zelenskyy', 'putin',
  // Geographies
  'gaza', 'palestine', 'palestinian',
  'lebanon', 'lebanese', 'beirut',
  'syria', 'syrian', 'damascus',
  'iraq', 'iraqi', 'baghdad',
  'yemen', 'yemeni',
  'ukraine', 'ukrainian', 'kyiv',
  'russia', 'russian', 'kremlin',
  'taiwan',
  'sudan', 'sudanese',
  'myanmar', 'burma',
  'nagorno', 'karabakh',
  // Orgs / alliances
  'nato',
])

const PHRASE_KEYWORDS = [
  'air strike', 'air force', 'ground offensive', 'proxy war',
  'war crime', 'chemical weapon', 'biological weapon',
  'north korea', 'kim jong',
  'south china sea', 'taiwan strait',
  'revolutionary guard', 'quds force',
  'islamic jihad', 'al-qaeda', 'al qaeda',
  'arms deal', 'weapons supply',
  'regime change',
  'humanitarian crisis', 'humanitarian corridor',
  'security council', 'international court',
  'nuclear deal', 'jcpoa',
  'cease-fire',
  'prisoner of war',
  'axis of resistance',
  'iron dome',
]

export function isRelevant(title: string, summary: string, lang: string): boolean {
  if (lang !== 'en') return true

  const text = `${title} ${summary}`.toLowerCase()
  const words = new Set(text.split(/\W+/))

  for (const word of words) {
    if (SINGLE_KEYWORDS.has(word)) return true
  }

  return PHRASE_KEYWORDS.some(phrase => text.includes(phrase))
}
```

**Step 4: Run tests — verify they all PASS**

Run: `npm run test -- relevance`
Expected: 11/11 passing

**Step 5: Commit**

```bash
git add src/lib/relevance.ts src/lib/relevance.test.ts
git commit -m "feat: add relevance filter with TDD — keyword-based conflict detection"
```

---

### Task 3: Wire isRelevant into the cron pipeline

**Files:**
- Modify: `src/routes/api/cron/+server.ts`

**Step 1: Import and apply the filter**

In `src/routes/api/cron/+server.ts`, add the import and filter:

```typescript
import { isRelevant } from '$lib/relevance'
```

Then update the articles pipeline (after `.flatMap(r => r.value)`) to add a relevance filter:

```typescript
const articles = results
  .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchFeed>>> => r.status === 'fulfilled')
  .flatMap(r => r.value)
  .filter(a => a.guid !== '')
  .filter(a => isRelevant(a.title, a.summary ?? '', a.source_lang))
```

**Step 2: Run full type-check**

Run: `npm run check`
Expected: 0 errors, 0 warnings

**Step 3: Run all tests**

Run: `npm run test`
Expected: all tests passing (8 original + 11 new = 19 total... or whatever the count is)

**Step 4: Commit**

```bash
git add src/routes/api/cron/+server.ts
git commit -m "feat: apply relevance filter in cron pipeline — drop non-conflict articles"
```

---

### Task 4: Push and verify

**Step 1: Push to GitHub**

```bash
git push
```

Vercel will auto-deploy. Wait ~60 seconds.

**Step 2: Trigger a test poll via cron-job.org**

Go to cron-job.org → WW3Watch RSS Poll → Test Run.

Check the response: `{"inserted": N, "total": M}` — `total` will be lower than before (fewer articles pass filter), `inserted` should be a reasonable number.

**Step 3: Verify the live site**

Open `https://ww3watch.vercel.app`. Confirm:
- No obviously off-topic articles (Japanese death penalty, drug lords, etc.)
- Conflict articles still flowing in normally
- Live dot still active
