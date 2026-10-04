-- Title embeddings shrink to half precision and keep 7 days, so the database
-- fits the free tier again and story grouping stops timing out.
--
-- Measured 2026-10-04: the database was 620 MB against the pipeline's 450 MB
-- ceiling (ops.ts checkOpsHealth), and every run since 2026-09-28 failed on it.
-- article_embeddings alone was 241 MB, 234 MB of it TOAST: a vector(768) is
-- 3,080 bytes, over the ~2 KB TOAST threshold, so every embedding lived out of
-- line in two chunks (~4.2 KB a row). Articles grew from ~500 to ~3,000 a day
-- in mid-September, and every one kept its embedding for the full 30 days.
--
-- The same out-of-line storage is why grouping timed out (57014). Gathering a
-- call's candidate stories reads each representative's embedding from TOAST;
-- when those pages are cold that took 2.5 s for ~2,100 candidates on an idle
-- database (30 ms warm), and past the 8 s statement timeout during a run.
-- Both nearest_story_candidates and assign_story_by_embedding failed in every
-- run from 2026-10-02 on, so new articles stayed ungrouped.
--
-- 1. halfvec(768) is 1,544 bytes: stored inline, no TOAST, ~40% of the
--    space. Cosine similarity moves by at most 3.5e-5 (max over 40,000 pairs
--    of production embeddings), far inside any threshold the pipeline uses.
-- 2. Retention keeps an embedding for 7 days, and longer only while it is the
--    representative of a story that is still active. Grouping compares
--    against stories created in the last 72 h (+8 h window), the merge pass
--    looks back 24 h, and story_join_sims callers look back hours; nothing
--    reads an older non-representative embedding. This is the one child table
--    with its own horizon rather than an orphan-prune against articles: its
--    rows are the largest in the database and are only useful while fresh.

-- Prune first, so the type change rewrites ~20k rows instead of ~58k.
delete from public.article_embeddings ae
 where ae.created_at < now() - interval '7 days'
   and not exists (select 1 from public.stories s
                    where s.rep_article_id = ae.article_id
                      and s.last_article_at > now() - interval '7 days');

-- Rewrites the table, which also returns the space the TOAST table held.
alter table public.article_embeddings
  alter column embedding type extensions.halfvec(768)
  using embedding::extensions.halfvec(768);

-- story_merge_candidates, reelect_story_reps and story_join_sims compare two
-- stored embeddings with each other, so they work unchanged on halfvec. The
-- two below compare a stored embedding with one passed in, and pgvector has no
-- operator between vector and halfvec, so the incoming one is converted.
-- Otherwise unchanged from 20260923230100 / 20260923220000.

create or replace function public.nearest_story_candidates(p_items jsonb, p_window_hours integer)
 returns table(r_article_id uuid, r_story_id uuid, r_rep_id uuid, r_rep_title text, r_sim real)
 language sql
 stable
 set search_path to ''
as $function$
  with items as (
    select (e->>'id')::uuid as id,
           coalesce((e->>'published_at')::timestamptz, now()) as ts,
           extensions.l2_normalize((e->>'embedding')::extensions.vector(768)::extensions.halfvec(768)) as v,
           ord
      from jsonb_array_elements(p_items) with ordinality as x(e, ord)
  ),
  bounds as (
    select min(ts) - make_interval(hours => p_window_hours) as lo,
           max(ts) + make_interval(hours => p_window_hours) as hi
      from items
  ),
  cands as materialized (
    select s.id, rep.id as rep_id, rep.title, s.last_article_at, s.created_at,
           extensions.l2_normalize(ae.embedding) as n
      from bounds b
      join public.stories s on s.last_article_at between b.lo and b.hi
                           and s.created_at > b.lo - interval '72 hours'
      join public.articles rep on rep.id = s.rep_article_id
      join public.article_embeddings ae on ae.article_id = rep.id
  )
  select i.id, c.id, c.rep_id, c.title, c.sim
    from items i
    left join lateral (
      select c.id, c.rep_id, c.title, (-(c.n operator(extensions.<#>) i.v))::real as sim
        from cands c
       where c.rep_id <> i.id
         and c.last_article_at between i.ts - make_interval(hours => p_window_hours)
                                   and i.ts + make_interval(hours => p_window_hours)
         and c.created_at > i.ts - interval '72 hours'
       order by c.n operator(extensions.<#>) i.v
       limit 1
    ) c on true
   order by i.ord
$function$;

create or replace function public.assign_story_by_embedding(p_items jsonb, p_model text, p_threshold real, p_window_hours integer)
 returns table(r_article_id uuid, r_story_id uuid, r_is_new boolean)
 language plpgsql
 set search_path to ''
as $function$
declare
  item jsonb;
  item_id uuid;
  item_ts timestamptz;
  v extensions.halfvec(768);
  vn extensions.halfvec(768);
  w interval;
  lo timestamptz;
  hi timestamptz;
  join_hint uuid;
  avoid_hint uuid;
  floor_sim real;
  best_story uuid;
  best_sim real;
  sid uuid;
  was_new boolean;
begin
  w := make_interval(hours => p_window_hours);
  select min(coalesce((e->>'published_at')::timestamptz, now())) - w,
         max(coalesce((e->>'published_at')::timestamptz, now())) + w
    into lo, hi
    from jsonb_array_elements(p_items) as e;

  -- This call's candidates, as unit vectors. Kept current as articles join
  -- (last_article_at) and as new stories are created, so a later item can
  -- join a story an earlier item in the same call started.
  create temp table if not exists _story_cands (
    story_id uuid primary key,
    rep_id uuid not null,
    created_at timestamptz not null,
    last_article_at timestamptz not null,
    n extensions.halfvec(768) not null
  ) on commit drop;
  truncate pg_temp._story_cands;
  insert into pg_temp._story_cands
  select s.id, rep.id, s.created_at, s.last_article_at, extensions.l2_normalize(ae.embedding)
    from public.stories s
    join public.articles rep on rep.id = s.rep_article_id
    join public.article_embeddings ae on ae.article_id = rep.id
   where s.last_article_at between lo and hi
     and s.created_at > lo - interval '72 hours';

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := (item->>'id')::uuid;
    item_ts := coalesce((item->>'published_at')::timestamptz, now());
    v := (item->>'embedding')::extensions.vector(768)::extensions.halfvec(768);
    vn := extensions.l2_normalize(v);
    join_hint := (item->>'join_story')::uuid;
    avoid_hint := (item->>'avoid_story')::uuid;
    floor_sim := greatest(p_threshold, coalesce((item->>'min_sim')::real, p_threshold));

    insert into public.article_embeddings (article_id, embedding, model)
    values (item_id, v, p_model)
    on conflict (article_id)
      do update set embedding = excluded.embedding, model = excluded.model;

    sid := null;
    if join_hint is not null then
      select s.id into sid from public.stories s where s.id = join_hint;
    end if;

    if sid is not null then
      was_new := false;
    else
      best_story := null;
      best_sim := null;
      select c.story_id, (-(c.n operator(extensions.<#>) vn))::real
        into best_story, best_sim
        from pg_temp._story_cands c
       where c.rep_id <> item_id
         and (avoid_hint is null or c.story_id <> avoid_hint)
         and c.last_article_at between item_ts - w and item_ts + w
         and c.created_at > item_ts - interval '72 hours'
       order by c.n operator(extensions.<#>) vn
       limit 1;

      if best_sim is not null and best_sim >= floor_sim then
        sid := best_story;
        was_new := false;
      else
        insert into public.stories (created_at, last_article_at, rep_article_id)
        values (item_ts, item_ts, item_id)
        returning id into sid;
        was_new := true;
      end if;
    end if;

    update public.articles
       set story_id = sid
     where id = item_id
       and story_id is null;

    update public.stories s
       set article_count = m.n,
           source_count = m.ns,
           region_count = m.nr,
           last_article_at = greatest(s.last_article_at, item_ts)
      from (select count(*) as n,
                   count(distinct source_name) as ns,
                   count(distinct source_region) as nr
              from public.articles
             where story_id = sid) m
     where s.id = sid;

    insert into pg_temp._story_cands
    select s.id, s.rep_article_id, s.created_at, s.last_article_at, extensions.l2_normalize(ae.embedding)
      from public.stories s
      join public.article_embeddings ae on ae.article_id = s.rep_article_id
     where s.id = sid
    on conflict (story_id) do update set last_article_at = excluded.last_article_at;

    r_article_id := item_id;
    r_story_id := sid;
    r_is_new := was_new;
    return next;
  end loop;
end;
$function$;

-- 3. Daily retention prunes embeddings by the rule in step 1.
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
  n_embeddings int;
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

  delete from public.article_embeddings ae
   where ae.created_at < now() - interval '7 days'
     and not exists (select 1 from public.stories s
                      where s.rep_article_id = ae.article_id
                        and s.last_article_at > now() - interval '7 days');
  get diagnostics n_embeddings = row_count;

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
    'articles=%s stories=%s content=%s translations=%s embeddings=%s rejects=%s verdicts=%s runs=%s trending_log=%s cron_details=%s',
    n_articles, n_stories, n_content, n_translations, n_embeddings, n_rejects, n_verdicts, n_runs, n_trending_log, n_cron
  );
end;
$$;
revoke all on function public.run_retention() from public;
grant execute on function public.run_retention() to service_role;

-- 4. AI reservations: ~13,000 a day (one per Jev call), kept 90 days, would
-- reach ~1.2M rows and ~240 MB. Month totals live in ai_months; a settled
-- reservation is only a receipt, so it goes after 7 days. An unsettled one
-- still holds its charge and keeps the 90 days.
create or replace function public.run_private_retention() returns void language plpgsql set search_path = '' as $$
begin
  delete from public.rate_limits where window_start < now()-interval '48 hours';
  delete from public.visitor_reports where created_at < now()-interval '90 days';
  delete from public.ai_reservations where settled and created_at < now()-interval '7 days';
  delete from public.ai_reservations where created_at < now()-interval '90 days';
end $$;
revoke all on function public.run_private_retention() from public, anon, authenticated;
grant execute on function public.run_private_retention() to service_role;
