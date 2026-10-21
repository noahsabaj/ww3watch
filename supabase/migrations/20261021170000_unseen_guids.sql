-- The guids a run has never seen, rather than the ones it has. A run checks
-- ~6,600 feed items and ~45 are new (2026-10-16), so existing_guids sent back
-- ~6,555 known guids every 5 minutes: ~70 MB a day of metered egress, part of
-- what exhausted the Free plan's 5 GB in October 2026. Same tables, same rule;
-- the pipeline falls back to existing_guids where this is not applied yet.
create or replace function public.unseen_guids(check_guids text[])
 returns table(guid text)
 language sql
 stable
 set search_path to ''
as $function$
  select g from unnest(check_guids) as g
  except
  select a.guid from public.articles a where a.guid = any(check_guids)
  except
  select r.guid from public.classified_rejects r where r.guid = any(check_guids)
$function$;

revoke all on function public.unseen_guids(text[]) from public;
grant execute on function public.unseen_guids(text[]) to service_role;
