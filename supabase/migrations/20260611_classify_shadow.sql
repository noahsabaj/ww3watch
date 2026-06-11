-- Classification shadow pre-filter groundwork. The pipeline starts (a)
-- storing rejected titles (needed to calibrate a relevance threshold later —
-- guid-only rejects can't be embedded retroactively) and (b) logging, in
-- shadow mode only, how an embedding-similarity pre-filter WOULD have agreed
-- with the LLM. Enabling the filter is a later change once ~a week of shadow
-- stats accumulates in pipeline_runs.stats.cls_prefilter.

alter table public.classified_rejects add column if not exists title text;

-- Mean embedding of recently-accepted articles: the "conflict-news prototype".
-- NOTE for callers: avg() of unit vectors is NOT unit-length — normalize
-- before using it for cosine similarity.
create or replace function public.relevant_centroid(p_days int)
returns extensions.vector(768)
language sql
stable
set search_path = ''
as $$
  select extensions.avg(ae.embedding)::extensions.vector(768)
    from public.article_embeddings ae
    join public.articles a on a.id = ae.article_id
   where a.fetched_at >= now() - make_interval(days => p_days)
$$;

revoke execute on function public.relevant_centroid(int) from public, anon, authenticated;
