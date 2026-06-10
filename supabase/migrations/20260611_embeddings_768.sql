-- Calibration outcome: multilingual-e5-small's cross-language margin was too
-- thin (cross-lang same-story pairs at p50 sim 0.802 vs a 0.87 precision
-- floor); multilingual-e5-base separates same-story from same-topic cleanly
-- at 0.83. 768 dims. Table is empty at this point (backfill runs after), so
-- the type change is free.

alter table public.article_embeddings
  alter column embedding type extensions.vector(768);

create or replace function public.assign_clusters_by_embedding(
  p_items jsonb,          -- [{"id": uuid, "published_at": ts|null, "embedding": [768 floats]}, ...]
  p_model text,
  p_threshold real,       -- cosine SIMILARITY floor (1 - distance)
  p_window_hours int
) returns table (r_article_id uuid, r_cluster_id text, r_is_new boolean)
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  item_id uuid;
  item_ts timestamptz;
  v extensions.vector(768);
  w interval;
  neighbor_cluster text;
  neighbor_sim real;
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

    -- Nearest representative within the item-relative window (exact scan).
    select a.cluster_id, 1 - (ae.embedding operator(extensions.<=>) v)
      into neighbor_cluster, neighbor_sim
      from public.article_embeddings ae
      join public.articles a on a.id = ae.article_id
     where a.cluster_id is not null
       and a.id::text = a.cluster_id
       and a.id <> item_id
       and a.published_at between item_ts - w and item_ts + w
     order by ae.embedding operator(extensions.<=>) v
     limit 1;

    if neighbor_sim is not null and neighbor_sim >= p_threshold then
      r_cluster_id := neighbor_cluster;
      r_is_new := false;
    else
      r_cluster_id := item_id::text;
      r_is_new := true;
    end if;

    -- cluster_id-null guard = pure idempotency; never stomp an assignment.
    update public.articles
       set cluster_id = r_cluster_id
     where id = item_id
       and articles.cluster_id is null;

    r_article_id := item_id;
    return next;
  end loop;
end;
$$;

revoke execute on function public.assign_clusters_by_embedding(jsonb, text, real, int)
  from public, anon, authenticated;
