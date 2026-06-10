-- Freshness indicator + retention.
--
-- pipeline_status(): the header's "updated Xm ago" readout — and our
-- dead-man's switch (the pipeline once died silently for three months).
-- Anchored on the last SUCCESSFUL ingestion run: failed runs don't refresh
-- data, so they don't reset the clock.
--
-- run_retention(): daily pg_cron prune. The feed serves the newest 500
-- articles; at ~900 ingested/day, 90%+ of rows are permanently invisible.

create or replace function public.pipeline_status()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(finished_at) from public.pipeline_runs where error is null
$$;
-- Deliberately world-callable (PUBLIC's default execute grant stays): it
-- exposes exactly one timestamp and nothing else from pipeline_runs.

create extension if not exists pg_cron;

create or replace function public.run_retention()
returns text
language plpgsql
set search_path = ''
as $$
declare
  n_articles int;
  n_content int;
  n_translations int;
  n_rejects int;
  n_runs int;
  n_cron int;
begin
  -- 1. Articles past the retention horizon. article_embeddings rides along
  --    via FK ON DELETE CASCADE. 30d: the feed serves ~1 day; share-links rot
  --    naturally; no live feed still lists 30-day-old guids.
  delete from public.articles where fetched_at < now() - interval '30 days';
  get diagnostics n_articles = row_count;

  -- 2. Reader cache rows whose article no longer exists — fully derived from
  --    article retention (the reader's articles.url gate 404s them anyway).
  delete from public.article_content c
   where not exists (select 1 from public.articles a where a.url = c.url);
  get diagnostics n_content = row_count;

  -- 3. Translations key by input_hash (no article join) — age them out.
  delete from public.article_translations where created_at < now() - interval '30 days';
  get diagnostics n_translations = row_count;

  -- 4. Rejects only matter while the guid can still appear in a feed.
  delete from public.classified_rejects where rejected_at < now() - interval '14 days';
  get diagnostics n_rejects = row_count;

  -- 5. Ingestion run log: 30 days of observability is plenty.
  delete from public.pipeline_runs where finished_at < now() - interval '30 days';
  get diagnostics n_runs = row_count;

  -- 6. pg_cron's own run log.
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  -- Captured in cron.job_run_details.return_message — the retention log.
  return format(
    'articles=%s content=%s translations=%s rejects=%s runs=%s cron_details=%s',
    n_articles, n_content, n_translations, n_rejects, n_runs, n_cron
  );
end;
$$;

-- This database's default ACLs grant PUBLIC execute on new functions — strip
-- it; only the cron job (runs as the owner) should call this.
revoke execute on function public.run_retention() from public, anon, authenticated;

-- Named schedules upsert in pg_cron 1.6 — re-runnable. 04:17 UTC daily.
select cron.schedule('ww3watch-retention', '17 4 * * *', $$select public.run_retention()$$);
