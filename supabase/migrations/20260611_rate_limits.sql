-- Per-IP rate limiting for the public edge functions. The articles.url gate
-- bounds WHAT can be requested, but not HOW OFTEN: translate's request body
-- (title/content) is caller-controlled, so unique variations bypass the cache
-- and each one burns LLM quota. Fixed hourly windows, generous human-proof
-- limits, enforced inside reader/translate via check_rate_limit().

create table if not exists public.rate_limits (
  ip text not null,
  fn text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (ip, fn, window_start)
);

-- Service-only: RLS on, no policies.
alter table public.rate_limits enable row level security;

-- Atomic check-and-increment. Returns true when the call is allowed.
create or replace function public.check_rate_limit(p_ip text, p_fn text, p_limit int)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  cur int;
begin
  insert into public.rate_limits as rl (ip, fn, window_start, count)
  values (p_ip, p_fn, date_trunc('hour', now()), 1)
  on conflict (ip, fn, window_start)
    do update set count = rl.count + 1
  returning count into cur;
  return cur <= p_limit;
end;
$$;

revoke execute on function public.check_rate_limit(text, text, int)
  from public, anon, authenticated;

-- Retention learns about the new table (windows are dead after an hour;
-- 2 days keeps a little forensic history).
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
  n_cron int;
  n_ratelimits int;
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

  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  delete from public.rate_limits where window_start < now() - interval '2 days';
  get diagnostics n_ratelimits = row_count;

  return format(
    'articles=%s stories=%s content=%s translations=%s rejects=%s runs=%s cron_details=%s rate_limits=%s',
    n_articles, n_stories, n_content, n_translations, n_rejects, n_runs, n_cron, n_ratelimits
  );
end;
$$;

revoke execute on function public.run_retention() from public, anon, authenticated;
