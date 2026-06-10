-- Clustering v2: multilingual title embeddings replace LLM cluster assignment.
-- Embeddings live in a side table (NOT a column on articles) so the client's
-- select=* payload and the realtime publication are untouched.

create extension if not exists vector with schema extensions;

create table if not exists public.article_embeddings (
  article_id uuid primary key references public.articles(id) on delete cascade,
  embedding  extensions.vector(384) not null,
  -- Embeddings are only comparable within one (model, revision, dtype) vintage;
  -- a model change requires re-backfill, keyed off this tag.
  model      text not null,
  created_at timestamptz not null default now()
);

-- Service-role only: RLS on, no policies (same pattern as classified_rejects).
alter table public.article_embeddings enable row level security;

-- Deliberately NO vector index: candidate sets are tiny time windows (~10^2
-- rows) where exact KNN is microseconds, while HNSW's global top-ef_search
-- candidates would be mostly old rows that the window filter then discards
-- WITHOUT resuming the scan (iterative_scan is off by default in pgvector
-- 0.8) — i.e. an index would cause silent false "new cluster" verdicts.

-- Assigns cluster_ids to a batch of freshly-embedded articles. Items must be
-- ordered chronologically ASC so later items can join clusters started by
-- earlier items in the same call. Star linkage: candidates are cluster
-- REPRESENTATIVES only (id-as-text = cluster_id, the convention the LLM
-- clusterer used), which prevents member-chained multi-day mega-clusters.
-- The window is item-relative (mirrors the client Jaccard fallback), so
-- self-healed backlog articles older than the window still find their peers.
create or replace function public.assign_clusters_by_embedding(
  p_items jsonb,          -- [{"id": uuid, "published_at": ts|null, "embedding": [384 floats]}, ...]
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
  v extensions.vector(384);
  w interval;
  neighbor_cluster text;
  neighbor_sim real;
begin
  w := make_interval(hours => p_window_hours);

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := (item->>'id')::uuid;
    item_ts := coalesce((item->>'published_at')::timestamptz, now());
    v := (item->>'embedding')::extensions.vector(384);

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

-- This database's default ACLs grant PUBLIC execute on new functions — strip
-- it (anon/authenticated inherit via PUBLIC, revoke them explicitly too).
revoke execute on function public.assign_clusters_by_embedding(jsonb, text, real, int)
  from public, anon, authenticated;

-- Pre-existing gap, same theme: the 20260609 revoke on existing_guids hit
-- anon+authenticated but missed the PUBLIC grant, leaving it anon-callable.
revoke execute on function public.existing_guids(text[]) from public;
