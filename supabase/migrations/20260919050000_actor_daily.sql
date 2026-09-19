-- /trends: per-actor daily activity. Counts STORIES, not articles, so twelve
-- outlets covering one strike count once; `major` is the subset judged a
-- significant event (articles.severity >= MAJOR_SEVERITY, src/lib/signals.ts).
-- A public aggregate over data anon can already read row by row, so it is
-- executable by anon; capped at 30 days (retention) so it cannot be made to scan more.
create or replace function public.actor_daily(p_days int default 30)
returns table (actor text, day date, stories bigint, major bigint)
language sql
stable
set search_path = ''
as $$
  select x.actor,
         (a.published_at at time zone 'utc')::date as day,
         count(distinct coalesce(a.story_id, a.id)) as stories,
         count(distinct coalesce(a.story_id, a.id)) filter (where a.severity >= 0.55) as major
    from public.articles a
   cross join lateral unnest(a.actors) as x(actor)
   where a.published_at > now() - make_interval(days => least(greatest(p_days, 1), 30))
     and a.published_at <= now()
   group by 1, 2
$$;

grant execute on function public.actor_daily(int) to anon, authenticated;
