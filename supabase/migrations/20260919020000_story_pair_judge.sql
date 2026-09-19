-- Story grouping: let the pipeline overrule the similarity threshold per item.
--
-- Embedding similarity measures "same SUBJECT", not "same EVENT". Of 2,505 joins
-- in a 48h prod sample, 1,886 (75%) sat at similarity 0.83-0.88, and a hand
-- check of that band found most were different events filed under one story
-- (above 0.88 every sampled join was right). The pipeline now asks TypeSafe's
-- Jev "same news story?" for candidates in the grey band
-- (src/lib/server/jev-pairs.ts) and passes the verdict down as per-item hints:
--
--   join_story  uuid  — Jev said SAME: join this story even below the threshold
--   avoid_story uuid  — Jev said DIFFERENT: this story is not a candidate
--   min_sim     real  — similarity floor for THIS item (raised for avoided items,
--                       so they cannot fall into the next-nearest story unjudged)
--
-- No hints → behaviour is exactly the previous version's.

-- 1. Read-only: the nearest active story for each item, so the pipeline can see
--    which candidates are in the grey band before anything is written. Same
--    candidate rule as assign_story_by_embedding.
create or replace function public.nearest_story_candidates(
  p_items jsonb,          -- [{"id": uuid, "published_at": ts|null, "embedding": [768 floats]}, ...]
  p_window_hours int
) returns table (r_article_id uuid, r_story_id uuid, r_rep_title text, r_sim real)
language plpgsql
stable
set search_path = ''
as $$
declare
  item jsonb;
  item_id uuid;
  item_ts timestamptz;
  v extensions.vector(768);
  w interval;
begin
  w := make_interval(hours => p_window_hours);
  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := (item->>'id')::uuid;
    item_ts := coalesce((item->>'published_at')::timestamptz, now());
    v := (item->>'embedding')::extensions.vector(768);

    r_article_id := item_id;
    r_story_id := null;
    r_rep_title := null;
    r_sim := null;
    select s.id, rep.title, 1 - (ae.embedding operator(extensions.<=>) v)
      into r_story_id, r_rep_title, r_sim
      from public.stories s
      join public.articles rep on rep.id = s.rep_article_id
      join public.article_embeddings ae on ae.article_id = rep.id
     where rep.id <> item_id
       and s.last_article_at between item_ts - w and item_ts + w
       and s.created_at > item_ts - interval '72 hours'
     order by ae.embedding operator(extensions.<=>) v
     limit 1;
    return next;
  end loop;
end;
$$;

revoke execute on function public.nearest_story_candidates(jsonb, int)
  from public, anon, authenticated;

-- 2. assign_story_by_embedding, now honouring the hints. Same signature.
create or replace function public.assign_story_by_embedding(
  p_items jsonb,          -- [{"id", "published_at", "embedding", "join_story"?, "avoid_story"?, "min_sim"?}, ...] chronological ASC
  p_model text,
  p_threshold real,       -- cosine SIMILARITY floor (1 - distance)
  p_window_hours int
) returns table (r_article_id uuid, r_story_id uuid, r_is_new boolean)
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  item_id uuid;
  item_ts timestamptz;
  v extensions.vector(768);
  w interval;
  join_hint uuid;
  avoid_hint uuid;
  floor_sim real;
  best_story uuid;
  best_sim real;
  sid uuid;
  was_new boolean;
begin
  w := make_interval(hours => p_window_hours);

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := (item->>'id')::uuid;
    item_ts := coalesce((item->>'published_at')::timestamptz, now());
    v := (item->>'embedding')::extensions.vector(768);
    join_hint := (item->>'join_story')::uuid;
    avoid_hint := (item->>'avoid_story')::uuid;
    floor_sim := greatest(p_threshold, coalesce((item->>'min_sim')::real, p_threshold));

    insert into public.article_embeddings (article_id, embedding, model)
    values (item_id, v, p_model)
    on conflict (article_id)
      do update set embedding = excluded.embedding, model = excluded.model;

    sid := null;
    -- A judged SAME verdict outranks the number. The story must still exist
    -- (retention may have pruned it between the two RPC calls).
    if join_hint is not null then
      select s.id into sid from public.stories s where s.id = join_hint;
    end if;

    if sid is not null then
      was_new := false;
    else
      -- Nearest story REPRESENTATIVE whose story is ACTIVE within the
      -- item-relative window (see 20260612_story_window.sql), minus the story a
      -- judged DIFFERENT verdict ruled out.
      best_story := null;
      best_sim := null;
      select s.id, 1 - (ae.embedding operator(extensions.<=>) v)
        into best_story, best_sim
        from public.stories s
        join public.articles rep on rep.id = s.rep_article_id
        join public.article_embeddings ae on ae.article_id = rep.id
       where rep.id <> item_id
         and (avoid_hint is null or s.id <> avoid_hint)
         and s.last_article_at between item_ts - w and item_ts + w
         and s.created_at > item_ts - interval '72 hours'
       order by ae.embedding operator(extensions.<=>) v
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

    r_article_id := item_id;
    r_story_id := sid;
    r_is_new := was_new;
    return next;
  end loop;
end;
$$;

revoke execute on function public.assign_story_by_embedding(jsonb, text, real, int)
  from public, anon, authenticated;

-- 3. Repair: take wrongly-merged articles OUT of their story so the pipeline's
--    own worklist (story_id IS NULL) re-assigns them, this time with a judge.
--    Never detaches a story's representative. Recomputes the counters of every
--    story it touched.
create or replace function public.detach_from_story(p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  touched uuid[];
  n integer;
begin
  select array_agg(distinct a.story_id) into touched
    from public.articles a
    join public.stories s on s.id = a.story_id
   where a.id = any(p_ids) and s.rep_article_id <> a.id;

  update public.articles a
     set story_id = null
    from public.stories s
   where a.id = any(p_ids) and s.id = a.story_id and s.rep_article_id <> a.id;
  get diagnostics n = row_count;

  update public.stories s
     set article_count = m.n, source_count = m.ns, region_count = m.nr
    from (select story_id,
                 count(*) as n,
                 count(distinct source_name) as ns,
                 count(distinct source_region) as nr
            from public.articles
           where story_id = any(touched)
           group by story_id) m
   where s.id = m.story_id;
  return n;
end;
$$;

revoke execute on function public.detach_from_story(uuid[])
  from public, anon, authenticated;

-- 4. Read-only, for scripts/repair-stories.ts: existing joins whose similarity to
--    their story's representative is below p_below (the judged band's ceiling).
create or replace function public.story_join_sims(p_since timestamptz, p_below real)
returns table (r_article_id uuid, r_title text, r_rep_title text, r_sim real)
language sql
stable
set search_path = ''
as $$
  select a.id, a.title, rep.title,
         (1 - (ae.embedding operator(extensions.<=>) re.embedding))::real
    from public.articles a
    join public.stories s on s.id = a.story_id
    join public.articles rep on rep.id = s.rep_article_id
    join public.article_embeddings ae on ae.article_id = a.id
    join public.article_embeddings re on re.article_id = rep.id
   where a.id <> rep.id
     and a.fetched_at > p_since
     and (1 - (ae.embedding operator(extensions.<=>) re.embedding)) < p_below
   order by a.id
$$;

revoke execute on function public.story_join_sims(timestamptz, real)
  from public, anon, authenticated;
