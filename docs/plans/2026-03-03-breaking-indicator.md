# Breaking Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a static red "BREAKING" badge on articles published within the last 30 minutes.

**Architecture:** Pure presentational change — add a `$derived` boolean `isBreaking` to both `ArticleCard` and `ClusterCard`, then conditionally render a badge in the header row. No new files, no tests (no testable logic outside the Svelte component).

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, TypeScript, Tailwind v4

---

### Task 1: Add breaking badge to ArticleCard.svelte

**Files:**
- Modify: `src/lib/components/ArticleCard.svelte`

**Step 1: Add `isBreaking` derived**

In the `<script>` block, after the `let { article }` props line, add:

```typescript
const isBreaking = $derived(
  !!article.published_at &&
  Date.now() - new Date(article.published_at).getTime() < 30 * 60 * 1000
)
```

**Step 2: Add badge in the header row**

In the template, the header row currently looks like:

```svelte
<div class="flex items-center gap-2 mb-1.5 flex-wrap">
  <span class="text-xs font-semibold px-2 py-0.5 rounded {REGION_COLORS[article.source_region]}">
    {article.source_region}
  </span>
  <span class="text-sm font-medium text-gray-300">
```

Add the badge immediately after the region badge span, before the source name span:

```svelte
<div class="flex items-center gap-2 mb-1.5 flex-wrap">
  <span class="text-xs font-semibold px-2 py-0.5 rounded {REGION_COLORS[article.source_region]}">
    {article.source_region}
  </span>
  {#if isBreaking}
    <span class="bg-red-950/60 border border-red-800/60 text-red-400 text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded">BREAKING</span>
  {/if}
  <span class="text-sm font-medium text-gray-300">
```

**Step 3: Run type-check**

```bash
cd D:/Code/ww3watch && npm run check
```

Expected: 0 errors, 0 warnings

**Step 4: Commit**

```bash
git add src/lib/components/ArticleCard.svelte
git commit -m "feat: add breaking badge to ArticleCard for articles under 30 minutes old"
```

---

### Task 2: Add breaking badge to ClusterCard.svelte

**Files:**
- Modify: `src/lib/components/ClusterCard.svelte`

**Step 1: Add `isBreaking` derived**

In the `<script>` block, after the existing `$derived` declarations (after `regionDots` and `repFlag`), add:

```typescript
const isBreaking = $derived(
  !!rep.published_at &&
  Date.now() - new Date(rep.published_at).getTime() < 30 * 60 * 1000
)
```

Note: `rep` is already defined as `$derived(cluster.representative)`, so this chains correctly.

**Step 2: Add badge in the header row**

The header row currently starts with:

```svelte
<div class="flex items-center gap-2 mb-1.5 flex-wrap">
  <span class="text-xs font-semibold px-2 py-0.5 rounded {REGION_COLORS[rep.source_region]}">
    {rep.source_region}
  </span>
  <span class="text-sm font-medium text-gray-300">
```

Add the badge immediately after the region badge span:

```svelte
<div class="flex items-center gap-2 mb-1.5 flex-wrap">
  <span class="text-xs font-semibold px-2 py-0.5 rounded {REGION_COLORS[rep.source_region]}">
    {rep.source_region}
  </span>
  {#if isBreaking}
    <span class="bg-red-950/60 border border-red-800/60 text-red-400 text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded">BREAKING</span>
  {/if}
  <span class="text-sm font-medium text-gray-300">
```

**Step 3: Run type-check and all tests**

```bash
cd D:/Code/ww3watch && npm run check && npm run test
```

Expected: 0 errors, 0 warnings, 21/21 tests passing

**Step 4: Commit**

```bash
git add src/lib/components/ClusterCard.svelte
git commit -m "feat: add breaking badge to ClusterCard for clusters under 30 minutes old"
```

---

### Task 3: Push and verify

**Step 1: Push**

```bash
git push
```

**Step 2: Verify on live site after Vercel deploys (~60s)**

Open `https://ww3watch.vercel.app`. Confirm:
- Articles published within the last 30 minutes show a red `BREAKING` badge after their region badge
- Articles older than 30 minutes show no badge
- Badge appears in both cluster cards (ClusterCard) and flat view (ArticleCard)
- Badge is static (no pulse/animation)
- Layout looks correct at all viewport widths (badge wraps cleanly in the flex row)
