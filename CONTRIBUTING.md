# Contributing to WW3Watch

Thanks for your interest. WW3Watch is a real-time global-conflict news aggregator:
a SvelteKit 2 / Svelte 5 static SPA on GitHub Pages, backed by Supabase (Postgres +
Realtime + Edge Functions) and an LLM-assisted ingestion pipeline. It runs on a
strict $0 budget, which shapes most of the engineering rules below.

## The one rule that matters most

**LLMs route, translate, and classify — they never emit load-bearing structure or
user-facing prose.** Story grouping, ordering, counts, badges, and the timeline are
all computed from data the client already holds. If a change would have a model
generate something the UI depends on for correctness, it's the wrong shape. The full
rationale and the rest of the house rules live in
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — please read it before a substantial PR.

## Local setup

```bash
npm install            # .npmrc pins onnxruntime CUDA off — keep it
cp .env.example .env    # then fill in the public values below
npm run dev             # http://localhost:5173/ww3watch
```

`.env` needs the **publishable** Supabase values (public by design — they ship in the
deployed bundle, so they are safe to use locally):

```
BASE_PATH=/ww3watch
PUBLIC_SUPABASE_URL=https://qusjbpknlduuklnfciws.supabase.co
PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```

## Checks (all must pass before a PR can merge)

```bash
npm run check          # svelte-check: 0 errors / 0 warnings
npm test               # vitest unit suite
npx playwright test    # e2e smoke suite (builds with empty BASE_PATH, serves at root)
```

For edge functions (Deno):

```bash
deno test --no-check --no-config --node-modules-dir=none supabase/functions/_shared/
```

CI (`.github/workflows/ci.yml`) runs the unit, e2e, and Deno jobs on every PR. Keep
new pure logic in a testable module (e.g. `src/lib/*.ts` or
`supabase/functions/_shared/*.ts`) with tests, rather than inline in a component.

## Suggesting or fixing a news source

Sources are **data**, not code — they live in the `sources` table, and feed curation
is done in SQL, not by editing a file. To propose adding, fixing, or disabling a feed,
open a **Source suggestion** issue (template provided) with the feed URL, the outlet's
region and primary language, and whether it's state / public / exile-affiliated. The
[`/about`](https://noahsabaj.github.io/ww3watch/) page shows the live roster and each
source's health.

## Pull requests

- Branch off `main`; keep PRs focused on one change.
- Match the surrounding code's style, comment density, and idioms.
- Explain the *why*, not just the *what* — this codebase documents tradeoffs.
- All CI checks green. Maintainers verify behavior before merging.

## Reporting bugs

Use the **Bug report** issue template. Because the feed is live data, include what you
saw, what you expected, the browser/OS, and a timestamp or screenshot where relevant.

By contributing you agree your contributions are licensed under the project's
[AGPL-3.0](LICENSE).
