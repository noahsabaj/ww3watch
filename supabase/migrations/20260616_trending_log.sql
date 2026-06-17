-- Trending history: the `trending` table is overwritten (delete-all + insert-3)
-- every pipeline run, so the record of WHAT was highlighted is otherwise lost.
-- trending_log is the append-only trail — one row per run, the picks denormalized
-- (title/source/region) so the /about "recently highlighted" view survives article
-- pruning. Public-interest data (what trended, when), so anon-readable like
-- sources/trending — no RPC needed.
create table if not exists public.trending_log (
  id        bigint generated always as identity primary key,
  logged_at timestamptz not null default now(),
  picks     jsonb not null
);

create index if not exists trending_log_logged_at_idx on public.trending_log (logged_at desc);

alter table public.trending_log enable row level security;
drop policy if exists "Public can read trending_log" on public.trending_log;
create policy "Public can read trending_log" on public.trending_log for select using (true);

-- Prune with the rest of retention (30 days, matching pipeline_runs). Re-defines
-- run_retention() wholesale (create or replace) to add the trending_log delete.
create or replace function public.run_retention()
returns text
language plpgsql
set search_path = ''
as $$
declare
  n_articles int;
  n_stories int;
  n_content int;
  n_translations int;
  n_rejects int;
  n_runs int;
  n_trending_log int;
  n_cron int;
begin
  delete from public.articles where fetched_at < now() - interval '30 days';
  get diagnostics n_articles = row_count;

  delete from public.stories s
   where not exists (select 1 from public.articles a where a.story_id = s.id);
  get diagnostics n_stories = row_count;

  delete from public.article_content c
   where not exists (select 1 from public.articles a where a.url = c.url);
  get diagnostics n_content = row_count;

  delete from public.article_translations where created_at < now() - interval '30 days';
  get diagnostics n_translations = row_count;

  delete from public.classified_rejects where rejected_at < now() - interval '14 days';
  get diagnostics n_rejects = row_count;

  delete from public.pipeline_runs where finished_at < now() - interval '30 days';
  get diagnostics n_runs = row_count;

  delete from public.trending_log where logged_at < now() - interval '30 days';
  get diagnostics n_trending_log = row_count;

  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  return format(
    'articles=%s stories=%s content=%s translations=%s rejects=%s runs=%s trending_log=%s cron_details=%s',
    n_articles, n_stories, n_content, n_translations, n_rejects, n_runs, n_trending_log, n_cron
  );
end;
$$;

revoke execute on function public.run_retention() from public, anon, authenticated;
