-- Drop indexes nothing reads, index the lookups that scan, and rewrite the one
-- report that runs a subquery per source.
--
-- Measured on prod 2026-10-17 (pg_stat_statements and pg_stat_user_indexes,
-- 130 days of stats; database 442 MB against the pipeline's 450 MB ceiling):
--
-- 1. verdicts_guid_idx: 49 MB, larger than the 38 MB table, used 8 times.
--    Nothing looks verdicts up by guid; retention deletes by created_at, which
--    has its own index. articles_source_lang_idx and articles_source_region_idx
--    were used 16 and 4 times: the site filters the feed in the browser.
-- 2. The signals stage's copy lookup (signals.ts annotatedCopies: title = ANY,
--    signals_at not null, fetched_at in the last 48 h) was the most expensive
--    statement by total time: 221k calls at 77 ms, each reading ~7,000 recent
--    rows through articles_fetched_at_idx to keep ~80. Equality only, so a hash
--    index: a few MB, against ~3x that for a btree on the text.
-- 3. silent_sources ran three correlated subqueries for each of ~170 sources,
--    2.9-6.8 s a run. Same answer from one grouped scan of each table, the
--    shape source_yield already has (~100 ms).
-- 4. pipeline_runs was read newest-first (previousRunJevDown, freshness) by a
--    sequential scan of ~7,000 rows each time.

drop index if exists public.verdicts_guid_idx;
drop index if exists public.articles_source_lang_idx;
drop index if exists public.articles_source_region_idx;

create index if not exists articles_title_annotated on public.articles using hash (title) where signals_at is not null;
create index if not exists pipeline_runs_started_at_idx on public.pipeline_runs (started_at desc);

create or replace function public.silent_sources(p_days integer, p_max_items integer)
 returns table(r_name text, r_last_item timestamp with time zone)
 language sql
 stable
 set search_path to ''
as $function$
  with acc as (
    select source_id, count(*) n from public.articles
     where fetched_at > now() - make_interval(days => p_days) group by 1
  ), rej as (
    select source_id, count(*) n from public.classified_rejects
     where rejected_at > now() - make_interval(days => p_days) group by 1
  )
  select s.name,
         (select max(coalesce(a.published_at, a.fetched_at)) from public.articles a where a.source_id = s.id)
    from public.sources s
    left join acc on acc.source_id = s.id
    left join rej on rej.source_id = s.id
   where s.enabled
     and s.last_ok_at > now() - interval '1 day'
     and coalesce(acc.n, 0) + coalesce(rej.n, 0) <= p_max_items
   order by s.name
$function$;
