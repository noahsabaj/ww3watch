-- purge_irrelevant_articles compared trending.article_id (TEXT) with articles.id
-- (UUID) and failed with "operator does not exist: text = uuid" on every call —
-- so the signals stage's second-opinion purge (#84) never removed anything (it
-- logs and carries on, by design). Only the trending guard changes.
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
     and not exists (select 1 from public.trending t where t.article_id = a.id::text);
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
