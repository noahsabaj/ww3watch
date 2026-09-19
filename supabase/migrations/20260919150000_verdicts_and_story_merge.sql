-- 1. verdicts — an append-only record of every relevance judgment.
--
-- Until now a verdict was implied by WHERE a row lived: in `articles` (accepted)
-- or `classified_rejects` (rejected, with a `reason` that needed three migrations
-- to keep up with who was judging). The probability behind the decision was
-- thrown away at the threshold, so "what would the feed look like at 0.4?", "how
-- often does the head disagree with Jev?" and "did the model's scores drift this
-- week?" could not be asked. Now they are queries.
--
-- Additive: `articles` and `classified_rejects` still drive the app and dedupe.
-- Lean on purpose (no title, no url — the free tier is 500 MB): ~9k rows/day.
create table if not exists public.verdicts (
  id          bigint generated always as identity primary key,
  guid        text        not null,
  judge       text        not null check (judge in ('head', 'jev', 'stale', 'purge')),
  decision    text        not null check (decision in ('accept', 'reject')),
  p           real,                          -- the judge's probability/score; null for 'stale' (nobody judged)
  threshold   real,                          -- the cut it was compared with
  model       text,                          -- 'jev-1.13.0', or the head's trained_at
  lang        text,
  source_id   uuid references public.sources (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists verdicts_created_at_idx on public.verdicts (created_at desc);
create index if not exists verdicts_guid_idx on public.verdicts (guid);

-- Service-only, like classified_rejects: RLS on, zero policies, no anon grant.
alter table public.verdicts enable row level security;
revoke all on public.verdicts from anon, authenticated;

-- What the knobs would do, per day and judge — the view to look at before moving
-- JEV_THRESHOLD or when stats.cls_jev.borderline climbs.
create or replace view public.verdict_daily
with (security_invoker = true) as
select (created_at at time zone 'utc')::date as day,
       judge,
       count(*)                                              as n,
       count(*) filter (where decision = 'accept')           as accepted,
       count(*) filter (where p is not null and abs(p - coalesce(threshold, 0.5)) < 0.3 and judge = 'jev') as borderline,
       count(*) filter (where p >= 0.4 and judge = 'jev')    as would_accept_at_040,
       count(*) filter (where p >= 0.6 and judge = 'jev')    as would_accept_at_060,
       round(avg(p)::numeric, 3)                             as mean_p
  from public.verdicts
 group by 1, 2;
revoke all on public.verdict_daily from anon, authenticated;

-- 2. Stories can MERGE.
--
-- An article can join a story, but two stories that turn out to be one event
-- ("31 dead in Pakistan after suicide bomber…" / "Death toll from Pakistan police
-- headquarters attack rises to 31") stayed apart forever: each article met the
-- other story's representative below the similarity band, or arrived before it
-- existed. The pipeline now compares the representatives of active stories, asks
-- Jev about the close pairs, and merges the ones it calls the same.
create or replace function public.story_merge_candidates(p_hours int, p_min_sim real, p_limit int)
returns table (r_a uuid, r_b uuid, r_a_title text, r_b_title text, r_a_count int, r_b_count int, r_sim real)
language sql
stable
set search_path = ''
as $$
  with active as (
    select s.id, s.article_count, rep.title, e.embedding
      from public.stories s
      join public.articles rep on rep.id = s.rep_article_id
      join public.article_embeddings e on e.article_id = rep.id
     where s.last_article_at > now() - make_interval(hours => p_hours)
  )
  select a.id, b.id, a.title, b.title, a.article_count, b.article_count,
         (1 - (a.embedding operator(extensions.<=>) b.embedding))::real
    from active a
    join active b on a.id < b.id
   where (1 - (a.embedding operator(extensions.<=>) b.embedding)) >= p_min_sim
   order by 7 desc
   limit p_limit
$$;
revoke execute on function public.story_merge_candidates(int, real, int) from public, anon, authenticated;

-- Move every member of p_from into p_into, repoint trending, drop the empty
-- story, recompute the survivor's counters. Returns the number of articles moved.
create or replace function public.merge_stories(p_from uuid, p_into uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  if p_from = p_into then return 0; end if;
  if not exists (select 1 from public.stories where id = p_into)
     or not exists (select 1 from public.stories where id = p_from) then
    return 0;
  end if;

  update public.articles set story_id = p_into where story_id = p_from;
  get diagnostics n = row_count;
  update public.trending set story_id = p_into where story_id = p_from;
  delete from public.stories where id = p_from;

  update public.stories s
     set article_count = m.n, source_count = m.ns, region_count = m.nr,
         last_article_at = greatest(s.last_article_at, m.newest)
    from (select count(*) as n,
                 count(distinct source_name) as ns,
                 count(distinct source_region) as nr,
                 max(coalesce(published_at, fetched_at)) as newest
            from public.articles where story_id = p_into) m
   where s.id = p_into;
  return n;
end;
$$;
revoke execute on function public.merge_stories(uuid, uuid) from public, anon, authenticated;

-- 3. Retention learns about verdicts (14 days, like the rejects they describe).
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
  n_verdicts int;
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

  delete from public.verdicts where created_at < now() - interval '14 days';
  get diagnostics n_verdicts = row_count;

  delete from public.pipeline_runs where finished_at < now() - interval '30 days';
  get diagnostics n_runs = row_count;

  delete from public.trending_log where logged_at < now() - interval '30 days';
  get diagnostics n_trending_log = row_count;

  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  return format(
    'articles=%s stories=%s content=%s translations=%s rejects=%s verdicts=%s runs=%s trending_log=%s cron_details=%s',
    n_articles, n_stories, n_content, n_translations, n_rejects, n_verdicts, n_runs, n_trending_log, n_cron
  );
end;
$$;
revoke all on function public.run_retention() from public;
grant execute on function public.run_retention() to service_role;
