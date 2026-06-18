-- June-18 deploy-skew cleanup. The story-first model shipped 2026-06-11 (PR #20):
-- articles.story_id uuid FK + stories table replaced the legacy id-as-text
-- cluster_id convention. Because the PWA runs registerType 'autoUpdate', N-1
-- clients lingered for ~a session after that deploy, so assign_story_by_embedding
-- kept MIRRORING the legacy cluster_id column. Those clients are long gone; this
-- removes the legacy surface.
--
-- Statement order matters: the function must stop referencing cluster_id BEFORE
-- the column is dropped.
--
-- The function body below is byte-identical to the LIVE definition (which equals
-- 20260612_story_window.sql, PR-A) EXCEPT the two cluster_id-mirror pieces are
-- removed: the `rep_text` declaration, the `select s.rep_article_id::text into
-- rep_text` lookup, and the `cluster_id = coalesce(...)` clause in the member
-- UPDATE. EVERYTHING else is preserved — in particular the candidate window
-- `s.last_article_at between item_ts - w and item_ts + w` +
-- `s.created_at > item_ts - interval '72 hours'` re-anchoring from PR-A.

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

    update public.articles
       set story_id = sid
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

-- The v2 cluster RPC, unused since the story RPC deployed (2026-06-11).
drop function if exists public.assign_clusters_by_embedding(jsonb, text, real, int);

-- One-shot story-model transition tool; also referenced cluster_id.
drop function if exists public.backfill_stories();

-- The legacy mirror column itself. Nothing writes it (the only writer was the
-- mirror clause removed above) and nothing reads it (the boot query was narrowed
-- to an explicit column list; the client resolves singletons via trending's
-- article_id + membership, never cluster_id).
alter table public.articles drop column if exists cluster_id;
