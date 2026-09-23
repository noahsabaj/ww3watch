-- Feeds that fetch fine and deliver nothing new.
--
-- Fetch health sees an HTTP error; source_yield sees a feed whose items are
-- almost all rejected. Neither sees a feed that still answers 200 with the
-- same stale items: every one is a duplicate, so nothing is written anywhere.
-- On 2026-09-23 nineteen enabled sources were like that (Xinhua's feeds stopped
-- in 2018, People's Daily's in June 2025, VOA's in March 2025), listed on the
-- site as sources while contributing nothing.
--
-- A source is silent when it fetched successfully in the last day, and
-- articles and classified_rejects together hold at most p_max_items from it in
-- p_days (Global Times' feed adds about one item a week).
create or replace function public.silent_sources(p_days int, p_max_items int)
returns table (r_name text, r_last_item timestamptz)
language sql
stable
set search_path = ''
as $$
  select s.name,
         (select max(coalesce(a.published_at, a.fetched_at)) from public.articles a where a.source_id = s.id)
    from public.sources s
   where s.enabled
     and s.last_ok_at > now() - interval '1 day'
     and (select count(*) from public.articles a
           where a.source_id = s.id and a.fetched_at > now() - make_interval(days => p_days))
       + (select count(*) from public.classified_rejects r
           where r.source_id = s.id and r.rejected_at > now() - make_interval(days => p_days))
         <= p_max_items
   order by s.name
$$;
revoke execute on function public.silent_sources(int, int) from public, anon, authenticated;
