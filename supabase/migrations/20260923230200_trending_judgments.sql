-- Trending's three judgments per candidate story (severity, fresh, talk), kept
-- by the exact question asked: a hash of the pinned model, the questions and
-- the story's state (its headline and up to four other headlines). A story
-- that hasn't changed since the last ranking is not asked again; 19 of the top
-- 20 candidates were unchanged over 15 minutes (2026-09-23). Rows older than
-- six hours are deleted by the pipeline (src/lib/server/trending.ts).
create table if not exists public.trending_judgments (
  state_key text primary key,
  severity real not null,
  fresh real not null,
  talk real not null,
  judged_at timestamptz not null default now()
);
create index if not exists trending_judgments_judged_at on public.trending_judgments (judged_at);

alter table public.trending_judgments enable row level security;
revoke all on table public.trending_judgments from anon, authenticated;
