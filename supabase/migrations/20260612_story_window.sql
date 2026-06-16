-- PR-A: anchor the story-assignment candidate window on stories.last_article_at
-- (NOT NULL, rolls forward with coverage) instead of the rep article's
-- published_at, which never moved. Two bugs fixed:
--   1. Slow-burn fragmentation: a story under continuous coverage shattered into
--      a new story every ~window hours because the rep's published_at aged out.
--   2. Null-published-rep blackhole: feeds with locale-formatted (Persian/Arabic)
--      pubDates yield reps with published_at NULL; `rep.published_at between ...`
--      is NULL→false, so those stories were permanently un-joinable and every
--      same-story article spawned another singleton — the exact cross-language
--      feeds embeddings exist to merge.
-- Similarity is still measured against the rep's embedding (star linkage bounds
-- topic drift), and created_at > item_ts - 72h caps the theoretical rolling
-- mega-story. Threshold + comparison vector unchanged ⇒ no recalibration.
-- The cluster_id mirror stays until the June-18 cleanup migration.
create or replace function public.assign_story_by_embedding(
  p_items jsonb,          -- [{"id": uuid, "published_at": ts|null, "embedding": [768 floats]}, ...] chronological ASC
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
  best_story uuid;
  best_sim real;
  sid uuid;
  was_new boolean;
  rep_text text;
begin
  w := make_interval(hours => p_window_hours);

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := (item->>'id')::uuid;
    item_ts := coalesce((item->>'published_at')::timestamptz, now());
    v := (item->>'embedding')::extensions.vector(768);

    insert into public.article_embeddings (article_id, embedding, model)
    values (item_id, v, p_model)
    on conflict (article_id)
      do update set embedding = excluded.embedding, model = excluded.model;

    -- Nearest story REPRESENTATIVE whose story is ACTIVE within the item-relative
    -- window. Anchored on stories.last_article_at (never null; rolls forward with
    -- coverage) instead of rep.published_at (never moved; null for some feeds).
    -- created_at > item_ts - 72h caps the rolling mega-story. Still joins through
    -- the rep so similarity is measured against the rep embedding (star linkage),
    -- and null-rep stories still can't be candidates.
    select s.id, 1 - (ae.embedding operator(extensions.<=>) v)
      into best_story, best_sim
      from public.stories s
      join public.articles rep on rep.id = s.rep_article_id
      join public.article_embeddings ae on ae.article_id = rep.id
     where rep.id <> item_id
       and s.last_article_at between item_ts - w and item_ts + w
       and s.created_at > item_ts - interval '72 hours'
     order by ae.embedding operator(extensions.<=>) v
     limit 1;

    if best_sim is not null and best_sim >= p_threshold then
      sid := best_story;
      was_new := false;
    else
      insert into public.stories (created_at, last_article_at, rep_article_id)
      values (item_ts, item_ts, item_id)
      returning id into sid;
      was_new := true;
    end if;

    -- Legacy mirror for N-1 clients: rep-id-as-text, exactly the v2 convention.
    -- coalesce never stomps a value the v2 RPC already wrote. (rep_text is never
    -- null on the join path: null-rep stories cannot be candidates.)
    select s.rep_article_id::text into rep_text from public.stories s where s.id = sid;
    update public.articles
       set story_id = sid,
           cluster_id = coalesce(cluster_id, coalesce(rep_text, item_id::text))
     where id = item_id
       and story_id is null;

    -- Recompute counters from actual membership (no blind increments);
    -- greatest() because self-heal delivers joins out of chronological order.
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
