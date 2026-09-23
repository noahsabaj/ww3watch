-- nearest_story_candidates also returns the story's representative id, so a
-- grouping verdict can be remembered for the merge pass
-- (src/lib/server/pipeline/clustering.ts judgeGreyBand).
--
-- When grouping asks "same event?" about an article and its nearest story at
-- a similarity at or above the merge floor and Jev says "different", the
-- article starts its own story with itself as representative, and the merge
-- pass would then ask about exactly those two headlines again, minutes later
-- in the same run: ~10 of its 60 questions a run (2026-09-23). The verdict is
-- written to story_merge_judged under the two representatives instead.
--
-- Only the return type changes (a new column), which needs drop + create;
-- the body is 20260923220000_story_assign_cache.sql's.
drop function if exists public.nearest_story_candidates(jsonb, integer);

create function public.nearest_story_candidates(p_items jsonb, p_window_hours integer)
 returns table(r_article_id uuid, r_story_id uuid, r_rep_id uuid, r_rep_title text, r_sim real)
 language sql
 stable
 set search_path to ''
as $function$
  with items as (
    select (e->>'id')::uuid as id,
           coalesce((e->>'published_at')::timestamptz, now()) as ts,
           extensions.l2_normalize((e->>'embedding')::extensions.vector(768)) as v,
           ord
      from jsonb_array_elements(p_items) with ordinality as x(e, ord)
  ),
  bounds as (
    select min(ts) - make_interval(hours => p_window_hours) as lo,
           max(ts) + make_interval(hours => p_window_hours) as hi
      from items
  ),
  cands as materialized (
    select s.id, rep.id as rep_id, rep.title, s.last_article_at, s.created_at,
           extensions.l2_normalize(ae.embedding) as n
      from bounds b
      join public.stories s on s.last_article_at between b.lo and b.hi
                           and s.created_at > b.lo - interval '72 hours'
      join public.articles rep on rep.id = s.rep_article_id
      join public.article_embeddings ae on ae.article_id = rep.id
  )
  select i.id, c.id, c.rep_id, c.title, c.sim
    from items i
    left join lateral (
      select c.id, c.rep_id, c.title, (-(c.n operator(extensions.<#>) i.v))::real as sim
        from cands c
       where c.rep_id <> i.id
         and c.last_article_at between i.ts - make_interval(hours => p_window_hours)
                                   and i.ts + make_interval(hours => p_window_hours)
         and c.created_at > i.ts - interval '72 hours'
       order by c.n operator(extensions.<#>) i.v
       limit 1
    ) c on true
   order by i.ord
$function$;

revoke all on function public.nearest_story_candidates(jsonb, integer) from public, anon, authenticated;
grant execute on function public.nearest_story_candidates(jsonb, integer) to service_role;
