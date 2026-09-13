-- replace_trending: give the DELETE a WHERE clause.
--
-- Production rejects `delete from public.trending;` with
--   21000: DELETE requires a WHERE clause
-- (Supabase's safe-update guard). Every pipeline run since 2026-08-17 hit it,
-- recorded trending='error:rpc' and kept the selection from that day — which
-- fell outside the client's 500-article window, so "Trending Now" silently
-- vanished from the site for four weeks. The CI stack has no such guard, so
-- the e2e suite could not see it. `where true` is the documented form the
-- guard accepts; TRUNCATE is avoided because it does not emit the realtime
-- DELETE events the client debounces its refetch on.

create or replace function public.replace_trending(
  p_rows jsonb,
  p_log_picks jsonb
) returns void
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
begin
  -- Clear current trending rows (safe-update requires a WHERE clause).
  delete from public.trending where true;

  -- Insert new trending rows
  if p_rows is not null and jsonb_array_length(p_rows) > 0 then
    for item in select value from jsonb_array_elements(p_rows)
    loop
      insert into public.trending (article_id, story_id, rank, selected_at)
      values (
        item->>'article_id',
        (item->>'story_id')::uuid,
        (item->>'rank')::smallint,
        coalesce((item->>'selected_at')::timestamptz, now())
      );
    end loop;
  end if;

  -- Append to trending_log
  if p_log_picks is not null and jsonb_array_length(p_log_picks) > 0 then
    insert into public.trending_log (picks)
    values (p_log_picks);
  end if;
end;
$$;

revoke execute on function public.replace_trending(jsonb, jsonb)
  from public, anon, authenticated;
