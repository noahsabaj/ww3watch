-- One row per ingestion-pipeline run: health-at-a-glance from the dashboard
-- instead of spelunking GitHub Actions logs, and a durable record of failures.
-- stats is jsonb so counters can evolve without re-migrating.

create table if not exists public.pipeline_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  error text,
  stats jsonb
);

-- Service-role only: RLS on, no policies.
alter table public.pipeline_runs enable row level security;
