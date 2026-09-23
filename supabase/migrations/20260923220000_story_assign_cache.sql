-- Story assignment reads each candidate story's representative embedding once
-- per call instead of once per article.
--
-- Both functions below compared every article in a call against every story
-- representative in its window by joining article_embeddings afresh: each
-- 768-float embedding is stored out of line (TOAST), so every comparison
-- re-read and re-assembled it. Measured 2026-09-23: 22ms an article against
-- 729 candidates, so ~0.5s (nearest_story_candidates) and ~0.8s
-- (assign_story_by_embedding) per 20-article chunk, twice a run.
--
-- Now each call gathers the candidates for the union of its articles' windows
-- once, as unit vectors, and each article is a dot product against that set.
-- Cosine similarity of unit vectors is their inner product, so
-- 1 - (a <=> b) = -(â <#> b̂); results are unchanged up to float rounding.
-- Same pattern as 20260923160000_story_merge_memory.sql.

create or replace function public.nearest_story_candidates(p_items jsonb, p_window_hours integer)
 returns table(r_article_id uuid, r_story_id uuid, r_rep_title text, r_sim real)
 language sql
 stable
 set search_path to ''
as $function$
  with items as (
    select (e->>'id')::uuid as id,
           coalesce((e->>'published_at')::timestamptz, now()) as ts,
           extensions.l2_normalize((e->>'embedding')::extensions.vector(768)) as v,
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
  select i.id, c.id, c.title, c.sim
    from items i
    left join lateral (
      select c.id, c.title, (-(c.n operator(extensions.<#>) i.v))::real as sim
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
  v extensions.vector(768);
  vn extensions.vector(768);
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
    n extensions.vector(768) not null
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
    v := (item->>'embedding')::extensions.vector(768);
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
