-- The stories the evidence stage locates, worked out where the rows are. To
-- find the few stories still to locate, evidence.ts read every major report of
-- the last 36 hours (647 rows) and the story_places row of each of their
-- stories (271) on every run: ~100 KB every 5 minutes on 2026-10-05, ~0.9 GB a
-- month of the Free plan's 5 GB of metered egress. Same rules, same order: a
-- news report (opinion and looking-back pieces left out, as eventSeverity
-- does) at or above the major severity, in a story with no place yet and no
-- unlocated try since p_retry_before; the story with the newest such report
-- first. The pipeline reads the rows itself, as before, where this is not
-- applied yet.
create or replace function public.stories_to_locate(
  p_since timestamptz,
  p_min_severity real,
  p_signal_yes real,
  p_retry_before timestamptz,
  p_limit integer
)
 returns table(story_id uuid)
 language sql
 stable
 set search_path to ''
as $function$
  select a.story_id
    from public.articles a
   where a.published_at >= p_since
     and a.story_id is not null
     and a.severity >= p_min_severity
     and coalesce(a.retrospective, 0) < p_signal_yes
     and coalesce(a.opinion, 0) < p_signal_yes
     and not exists (
       select 1 from public.story_places sp
        where sp.story_id = a.story_id
          and (sp.place_id is not null or sp.located_at > p_retry_before))
   group by a.story_id
   order by max(a.published_at) desc
   limit p_limit
$function$;

revoke all on function public.stories_to_locate(timestamptz, real, real, timestamptz, integer) from public;
grant execute on function public.stories_to_locate(timestamptz, real, real, timestamptz, integer) to service_role;
