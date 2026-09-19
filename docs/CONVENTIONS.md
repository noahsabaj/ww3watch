# Conventions

The rules this codebase runs on. Each one was paid for; the receipts are in the
git history. New code follows them or argues in a PR why it shouldn't.

## The constitution

**Machine intelligence routes stories; it never rewrites them.** A local
classifier, an embedding model and a decision model (TypeSafe's Jev, which
cannot generate text) decide *whether* an article appears (relevance), *where*
it belongs (story grouping), and *how prominently* (trending). They never touch
what a journalist wrote. Translation is the lone exception — and the only
generative LLM in the project: opt-in, labeled, one click from the original. Any feature that would put model-written prose in
front of users by default is out of scope by design.

## Supabase

- **Every new function**: `revoke execute on function ... from public, anon,
  authenticated;` — this database's per-schema default privileges ADD to
  PostgreSQL's built-in PUBLIC execute grant, so revoking anon/authenticated
  alone leaves the function PUBLIC-callable (this happened: `existing_guids`).
  Grant back narrowly if anon genuinely needs it (`pipeline_status`).
- **Every function**: `set search_path = ''` + fully-qualified names —
  including operators (`operator(extensions.<=>)`) and aggregates
  (`extensions.avg`), which do NOT resolve via the empty path.
- **Service-only tables**: RLS enabled, zero policies (`classified_rejects`,
  `stories`, `article_embeddings`, …). Public tables get explicit
  `for select using (true)` policies.
- **Migrations**: applied via the Supabase MCP AND committed to
  `supabase/migrations/` in the same PR. One file per change, **14-digit**
  version (`YYYYMMDDHHMMSS_name.sql`), never edited once applied; a function is
  changed by a NEW migration that replaces it. `20260919140000_baseline.sql` is
  the schema as of that date — a `pg_dump` of what the previous 38 files built
  (nine of them shared an 8-digit version, which current CLIs refuse; their
  history is in git before the commit that added the baseline). Every migration
  is proven in CI three ways: it applies to an empty database, every public
  function is then CALLED (`supabase/tests/rpc_smoke.sql` — plpgsql bodies are
  not checked at CREATE time, and generated types cannot see a text/uuid
  mismatch), and the repo type-checks against types generated from the result.
  Backfills that need app logic run as repo scripts through the
  `run-script.yml` workflow (never reimplement a TS normalization/hash in SQL —
  drift silently breaks equality).
- **Scheduling**: pg_cron for anything that doesn't need a runner
  (`run_retention`, daily). Retention derives: child tables orphan-prune
  against articles rather than carrying second time horizons.
- **Text columns fed from the wild**: strip control characters first —
  Postgres `text` rejects NUL, and one bad row poisons a whole batched upsert.
- **Every DELETE/UPDATE needs a WHERE clause** — production runs Supabase's
  safe-update guard (`21000: DELETE requires a WHERE clause`); the CI stack
  does not, so a bare `delete from t;` passes every test and fails only in
  prod. Write `where true` when you mean all rows (`replace_trending` shipped
  without it and trending was stuck for four weeks).

## Models

- **Never make a model emit load-bearing structure.** Exactly-N arrays failed
  twice; "preserve the HTML" broke translate in production. The pipeline now
  satisfies this by construction: Jev cannot generate text — it returns a
  probability or a choice per typed question, and code does the rest. The rule
  still binds the one generative call left, translation: plain text in,
  `response_format: json_object` out, with a `finish_reason` check.
- **All pipeline judgments** go through `callJev` (`src/lib/server/jev.ts`:
  429/529 + Retry-After backoff, bounded by the run deadline). No generative
  LLM runs in ingestion; the only one in the project is the `translate` edge
  function, whose `LLM_*` secrets `deploy-functions.yml` syncs from GitHub.
- **Ask Jev narrow, literal questions — one judgment each.** It reads the
  question as written and will not infer intent, so the condition goes in the
  question and the boundary cases go in the criteria. Send only the state the
  question needs; irrelevant state costs accuracy.
- **Never ask Jev to count, compare dates, or do arithmetic.** Code does that,
  exactly. Trending is the pattern: Jev judges severity / new-development /
  talk-only per story, and code weighs those against exact corroboration
  counts (`src/lib/server/trending-jev.ts`). The weights live in source, where
  a diff can change them — not in a prompt.
- **A failed Jev call is never a verdict.** No fallback guesses: an unjudged
  article stays "new" for the next run, an un-annotated one stays on the
  signals worklist, an unjudged story pair gets no hint, and a failed trending
  pass keeps the previous selection (`error:jev`, which `trendingStuck`
  eventually turns into a failed run).
- **Pin model artifacts.** Embeddings carry a `(model, revision, dtype)` tag;
  HF repos are mutable, and an unpinned re-quantization silently invalidates
  every stored vector plus the calibrated threshold. Changing any of it means
  re-backfill + re-calibration. Same for Jev: the model is pinned
  (`jev-1.13.0`, never `jev-latest`) because `JEV_THRESHOLD` and the pair band
  are tuned to that version's probabilities, and an alias moves without a
  change on our side.
- **Calibrate against audited examples, not raw metrics.** When ground-truth
  labels come from a weaker system, your improvements show up as "errors" —
  the clustering threshold was chosen from a hand-audited boundary band, not
  the false-merge sweep. Measure before enabling: the relevance head picks its
  thresholds on a held-out split with per-language false-reject caps, refuses
  to ship a fit that fails them, and keeps auditing itself in production
  (`stats.cls_head.audit_agreement` — a random ~3% slice of its confident
  verdicts is judged by Jev anyway, every run). Jev itself was measured before
  it became the final judge (`docs/evals/2026-09-19-jev-relevance.md`: AUC 0.956 on 1,475
  LLM-labelled titles in 7 languages).
- Prefer deterministic local models on the runner over API calls wherever
  they suffice — free, uncapped, reproducible. The relevance head
  (`src/lib/server/prefilter.ts`, trained by `train-classifier.yml`) is the
  pattern: distil Jev's verdicts into a local model, keep Jev for the
  uncertain band, and never train on the local model's own output
  (`classified_rejects.reason` keeps 'jev' — plus historical 'llm' — apart
  from 'head' and 'stale' for exactly this).

## Code layout

- **The pipeline is stages, not a script.** `scripts/run-pipeline.ts` is only an
  entry point. `src/lib/server/pipeline/run.ts` is the order of stages and what
  flows between them; each stage is its own module beside it. A stage takes
  `stats`, never fails the run for a recoverable problem, and is a *worklist*
  wherever it can be (`story_id IS NULL`, `signals_at IS NULL`) so an outage
  drains over later runs instead of losing work.
- **A judge is a value.** Relevance tiers implement `RelevanceTier`
  (`src/lib/server/judges.ts`) and the pipeline runs a list of them. The repo
  went through three judgment systems threaded in by hand; the fourth is an
  edit to `defaultTiers()`.
- **Every judgment is recorded** with its probability, threshold and model
  version (`verdicts`), not just its outcome. A threshold question should be a
  query (`verdict_daily`), not an experiment.
- **One place for numbers.** Tunables live in `src/lib/server/config.ts`; every
  run records the values it used (`stats.config`); the README table is
  generated from it and CI fails when stale. A constant that must exist in
  another runtime (Deno, SQL) gets a test that reads all the copies
  (`src/lib/cross-runtime.test.ts`).
- **One pool.** Bounded concurrency is `mapPool` (`src/lib/server/pool.ts`); it
  never rejects, because every caller's policy is the same — a failed call is
  not a verdict.
- **Typed at the database boundary.** Both Supabase clients are typed with the
  generated schema (`src/lib/database.types.ts`, narrowed once in
  `src/lib/db.ts`). No `as` on query or RPC results.
- **Boundaries are where the bugs were** — SQL↔TS, YAML↔shell, CRLF↔LF, a
  constant in two runtimes — so each has a machine check: the RPC smoke test,
  `scripts/ci/*` with injected `gh`, `.gitattributes`, the cross-runtime test.
  When adding a boundary, add its check.
- **Workflow logic lives in `scripts/ci/`**, tested, with `gh` injected as an
  argv-array runner. Workflows keep triggers, conditions and env. The
  exception is anything that must run when `npm ci` itself failed (failure
  alerts, the chain's fallback): that stays in bash, and says why.

## Deploy skew (PWA)

`registerType: 'autoUpdate'` keeps N-1 bundles alive for roughly a session
after every deploy. Any schema/protocol change must serve BOTH client
generations until a later cleanup: mirror old columns (`cluster_id` was kept
alongside `story_id` until the June-18 cleanup dropped it), keep old request
shapes working (translate accepts HTML and plain text), and tolerate missing
fields from SW-cached REST rows (`story_id ?? id`).

## Frontend

- **Sanitize at the sink.** The browser's DOMPurify pass at `{@html}` is the
  only sanitizer that counts (server-side DOMPurify in Deno was a silent
  no-op). Cache content RAW so sanitizer upgrades apply retroactively — the
  hook that absolutizes URLs and forces `target="_blank"` fixed every cached
  article the moment it shipped.
- Time-derived labels read `clock.now` (`$lib/now.svelte.ts`) so they tick;
  anchor values refresh via realtime events, not polling.
- No `backdrop-filter` on ancestors of `position: fixed` children — it creates
  a containing block and quietly reanchors them (the sticky header's dropdown).
- Realtime channels: dedupe on INSERT replays, patch UPDATEs into whichever
  list holds the row, and treat event payloads as signals to refetch rather
  than state to apply when delivery semantics are subtle (trending).

## Workflows

- `actions/cache` restore/save SPLIT, with saves gated on a
  written-after-success sentinel — a partial download cached under an
  immutable key is forever.
- Model/browser binaries are cached by content key (`me5b-q8-<rev>`,
  `playwright-<lockfile hash>`).
- One-off production scripts run through `run-script.yml` (workflow_dispatch),
  which carries the standard secrets.
- The pipeline THROWS on a failed/empty roster query: a zero-feed "success"
  would reset the freshness dead-man's switch. Failures must be loud; the
  header's "updated Xm ago" readout exists because the pipeline once died
  silently for three months.
- **A recorded status is not an alert.** `stats.trending='error:rpc'` was
  written on every run for four weeks and nobody saw it. Any stage that can
  fail without failing the run needs a stuck-detector that eventually DOES
  fail the run (`trendingStuck`), plus a prod-smoke assertion for what the
  user would see missing.
- **Cadence is self-chained.** GitHub throttles a `*/15` cron to ~7 runs a
  day; `pipeline.yml`'s last step dispatches the next run, paced by
  `CADENCE_SECONDS`, and the cron is only the backstop. Cancelling a run
  stops the chain until the cron restarts it. Stages that call Jev per
  run must pace themselves (`TRENDING_MIN_INTERVAL_MS`) or the chain
  multiplies their daily cost — and a top-three re-ranked every run reads
  as noise.
