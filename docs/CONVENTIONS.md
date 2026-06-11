# Conventions

The rules this codebase runs on. Each one was paid for; the receipts are in the
git history. New code follows them or argues in a PR why it shouldn't.

## The constitution

**Machine intelligence routes stories; it never rewrites them.** LLMs and
embedding models decide *whether* an article appears (relevance), *where* it
belongs (story grouping), and *how prominently* (trending). They never touch
what a journalist wrote. Translation is the lone exception: opt-in, labeled,
one click from the original. Any feature that would put model-written prose in
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
  `supabase/migrations/` in the same PR. Backfills that need app logic run as
  repo scripts through the `run-script.yml` workflow (never reimplement a TS
  normalization/hash in SQL — drift silently breaks equality).
- **Scheduling**: pg_cron for anything that doesn't need a runner
  (`run_retention`, daily). Retention derives: child tables orphan-prune
  against articles rather than carrying second time horizons.
- **Text columns fed from the wild**: strip control characters first —
  Postgres `text` rejects NUL, and one bad row poisons a whole batched upsert.

## LLMs and models

- **Never make an LLM emit load-bearing structure.** Exactly-N arrays failed
  twice; "preserve the HTML" broke translate in production. Batch verdicts use
  index-keyed JSON objects parsed tolerantly; translation sends plain text and
  uses `response_format: json_object` with a `finish_reason` check.
- **All LLM calls** go through `callLLM` (rate limiter + 429/Retry-After
  backoff). Free-tier RPM shapes architecture; assume the limiter is load-bearing.
- **Pin model artifacts.** Embeddings carry a `(model, revision, dtype)` tag;
  HF repos are mutable, and an unpinned re-quantization silently invalidates
  every stored vector plus the calibrated threshold. Changing any of it means
  re-backfill + re-calibration.
- **Calibrate against audited examples, not raw metrics.** When ground-truth
  labels come from a weaker system, your improvements show up as "errors" —
  the clustering threshold was chosen from a hand-audited boundary band, not
  the false-merge sweep. Measure in shadow mode before enabling anything
  (`stats.cls_prefilter`).
- Prefer deterministic local models on the runner over API LLMs wherever
  judgment isn't required — quota-free, uncapped, reproducible.

## Deploy skew (PWA)

`registerType: 'autoUpdate'` keeps N-1 bundles alive for roughly a session
after every deploy. Any schema/protocol change must serve BOTH client
generations until a later cleanup: mirror old columns (`cluster_id` alongside
`story_id`), keep old request shapes working (translate accepts HTML and plain
text), and tolerate missing fields from SW-cached REST rows (`story_id ?? id`).

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
