# Breaking Indicator Design

## Goal
Visually distinguish articles under 30 minutes old from older content, so a 5-minute-old strike report doesn't feel the same as a 6-hour-old analysis.

## Approach
Static red badge in the header row of each card. No animation, no card background change — badge only.

## Logic
- Breaking = `published_at` exists AND `Date.now() - new Date(published_at).getTime() < 30 * 60 * 1000`
- Computed as `$derived` in each component
- Clears naturally as components re-render when new articles arrive or filters change
- No interval/timer needed

## Badge

**Placement:** Right after the region badge in the header row
```
[US/Western] BREAKING  New York Times  ● ● ● +4 more       2m ago
```

**Styling:**
```
bg-red-950/60 border border-red-800/60 text-red-400 text-[10px] font-bold tracking-widest px-1.5 py-0.5 rounded
```

Dark red, small, uppercase, letter-spaced — fits the dark theme without being loud.

## Files Changed
- `src/lib/components/ArticleCard.svelte` — `isBreaking` derived + badge in header
- `src/lib/components/ClusterCard.svelte` — same, using `rep.published_at`

## Not In Scope
- Animation/pulse
- Card background change
- Configurable threshold
- Tests (pure presentational)
