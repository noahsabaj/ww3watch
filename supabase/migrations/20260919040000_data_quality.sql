-- Three service-only helpers for feed and story quality.

-- 1. purge_irrelevant_articles: remove accepted articles a later, better judgment
--    says do not belong (the signals stage records Jev's P(relevant) for EVERY
--    accepted article, including the local head's accepts, which never passed
--    Jev's relevance gate). The guid moves to classified_rejects so the article
--    is not re-ingested on the next fetch. Never touches an article that is
--    currently trending. Repairs the stories it leaves behind.
create or replace function public.purge_irrelevant_articles(p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  doomed uuid[];
  touched uuid[];
  n integer;
begin
  select array_agg(a.id) into doomed
    from public.articles a
   where a.id = any(p_ids)
     and not exists (select 1 from public.trending t where t.article_id = a.id);
  if doomed is null then return 0; end if;

  select array_agg(distinct a.story_id) into touched
    from public.articles a where a.id = any(doomed) and a.story_id is not null;

  insert into public.classified_rejects (guid, title, source_id, lang, reason)
  select a.guid, a.title, a.source_id, a.source_lang, 'jev'
    from public.articles a where a.id = any(doomed)
  on conflict (guid) do nothing;

  delete from public.articles a where a.id = any(doomed);
  get diagnostics n = row_count;

  if touched is not null then
    -- A story whose representative was purged (FK set it null) gets its newest
    -- remaining member; a story with nobody left is removed.
    update public.stories s
       set rep_article_id = (select a.id from public.articles a
                              where a.story_id = s.id
                              order by a.published_at desc nulls last limit 1)
     where s.id = any(touched) and s.rep_article_id is null;
    delete from public.stories s
     where s.id = any(touched)
       and not exists (select 1 from public.articles a where a.story_id = s.id);
    update public.stories s
       set article_count = m.n, source_count = m.ns, region_count = m.nr
      from (select story_id, count(*) as n,
                   count(distinct source_name) as ns,
                   count(distinct source_region) as nr
              from public.articles where story_id = any(touched) group by story_id) m
     where s.id = m.story_id;
  end if;
  return n;
end;
$$;

revoke execute on function public.purge_irrelevant_articles(uuid[])
  from public, anon, authenticated;

-- 2. reelect_story_reps: a story's representative is what every later article is
--    compared against (star linkage). It was simply the first article to arrive —
--    often a reaction or a vague headline, which then attracts loosely related
--    coverage. Re-elect the MEDOID: the member most similar, on average, to the
--    rest. Bounded to stories of 3..80 members (pairwise cost is quadratic).
create or replace function public.reelect_story_reps(p_story_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  with sized as (
    select a.story_id
      from public.articles a
     where a.story_id = any(p_story_ids)
     group by a.story_id
    having count(*) between 3 and 80
  ), centrality as (
    select a.story_id, a.id as article_id, a.published_at,
           (select avg(1 - (e.embedding operator(extensions.<=>) e2.embedding))
              from public.articles a2
              join public.article_embeddings e2 on e2.article_id = a2.id
             where a2.story_id = a.story_id and a2.id <> a.id) as c
      from public.articles a
      join public.article_embeddings e on e.article_id = a.id
     where a.story_id in (select story_id from sized)
  ), medoid as (
    select distinct on (story_id) story_id, article_id
      from centrality
     where c is not null
     order by story_id, c desc, published_at asc nulls last
  )
  update public.stories s
     set rep_article_id = m.article_id
    from medoid m
   where s.id = m.story_id and s.rep_article_id is distinct from m.article_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.reelect_story_reps(uuid[])
  from public, anon, authenticated;

-- 3. source_yield: feeds that fetch fine but almost never produce an accepted
--    article. Fetch health (consecutive_failures) cannot see these. 'stale'
--    write-offs are not verdicts and are excluded.
create or replace function public.source_yield(p_days int, p_min_items int, p_max_pct real)
returns table (r_name text, r_accepted bigint, r_rejected bigint, r_pct real)
language sql
stable
set search_path = ''
as $$
  with acc as (
    select source_id, count(*) n from public.articles
     where fetched_at > now() - make_interval(days => p_days) group by 1
  ), rej as (
    select source_id, count(*) n from public.classified_rejects
     where rejected_at > now() - make_interval(days => p_days)
       and reason in ('jev', 'head', 'llm') group by 1
  )
  select s.name, coalesce(acc.n, 0), coalesce(rej.n, 0),
         (100.0 * coalesce(acc.n, 0) / (coalesce(acc.n, 0) + coalesce(rej.n, 0)))::real
    from public.sources s
    left join acc on acc.source_id = s.id
    left join rej on rej.source_id = s.id
   where s.enabled
     and coalesce(acc.n, 0) + coalesce(rej.n, 0) >= p_min_items
     and 100.0 * coalesce(acc.n, 0) / (coalesce(acc.n, 0) + coalesce(rej.n, 0)) <= p_max_pct
   order by 4 asc, 3 desc
$$;

revoke execute on function public.source_yield(int, int, real)
  from public, anon, authenticated;
