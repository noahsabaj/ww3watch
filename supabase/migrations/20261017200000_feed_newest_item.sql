-- A feed's own newest item, so silent_sources tells a stale file from a
-- publisher that posts weekly. Bellingcat and The Grayzone were reported
-- "gone silent" on 2026-10-17 with items two and three days old in their
-- feeds: few new items in 7 days, but nothing stale. The newest pubDate is
-- what a stale file gets wrong.
alter table public.sources add column if not exists newest_item_at timestamptz;

create or replace function public.record_source_health(p_results jsonb, p_disable_after integer)
 returns table(source_id uuid, source_name text, disabled boolean)
 language plpgsql
 set search_path to ''
as $function$
begin
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) > 500
     or p_disable_after is null or p_disable_after < 1 or p_disable_after > 10000 then
    raise exception 'invalid source health batch';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_results) as r(id uuid, url text, observed_updated_at timestamptz, ok boolean, via text, error_kind text)
    where r.id is null or r.url is null or r.observed_updated_at is null or r.ok is null
       or r.via is null or r.via not in ('direct','proxy')
       or (not r.ok and (r.error_kind is null or r.error_kind not in ('http','timeout','parse','network','blocked')))
  ) or exists (
    select 1 from jsonb_to_recordset(p_results) as r(id uuid) group by r.id having count(*) > 1
  ) then raise exception 'invalid source health result'; end if;

  return query
  with changed as (
    update public.sources as s set
      last_ok_at = case when r.ok then clock_timestamp() else s.last_ok_at end,
      last_via = r.via,
      consecutive_failures = case when r.ok then 0 else s.consecutive_failures + 1 end,
      last_error_kind = case when r.ok then null else r.error_kind end,
      last_error = case when r.ok then null else left(regexp_replace(coalesce(r.error_detail,''), '[[:cntrl:]]', '', 'g'),300) end,
      feed_etag = case when r.ok then left(r.etag, 500) else s.feed_etag end,
      feed_last_modified = case when r.ok then left(r.last_modified, 100) else s.feed_last_modified end,
      -- Absent on a 304 or an undated feed: keep what the last full fetch saw.
      newest_item_at = case when r.ok then coalesce(r.newest_item_at, s.newest_item_at) else s.newest_item_at end,
      enabled = case when not r.ok and s.consecutive_failures + 1 >= p_disable_after then false else s.enabled end,
      updated_at = clock_timestamp()
    from jsonb_to_recordset(p_results) as r(id uuid, url text, observed_updated_at timestamptz, ok boolean, via text, error_kind text, error_detail text, etag text, last_modified text, newest_item_at timestamptz)
    where s.id = r.id and s.url = r.url and s.enabled and s.updated_at = r.observed_updated_at
    returning s.id, s.name, not s.enabled as disabled
  ) select c.id, c.name, c.disabled from changed as c;
end;
$function$;

-- Silent: few new items in p_days AND the feed's newest item is older than that
-- (or unknown: never fetched in full, or undated).
create or replace function public.silent_sources(p_days integer, p_max_items integer)
 returns table(r_name text, r_last_item timestamp with time zone)
 language sql
 stable
 set search_path to ''
as $function$
  with acc as (
    select source_id, count(*) n from public.articles
     where fetched_at > now() - make_interval(days => p_days) group by 1
  ), rej as (
    select source_id, count(*) n from public.classified_rejects
     where rejected_at > now() - make_interval(days => p_days) group by 1
  )
  select s.name,
         (select max(coalesce(a.published_at, a.fetched_at)) from public.articles a where a.source_id = s.id)
    from public.sources s
    left join acc on acc.source_id = s.id
    left join rej on rej.source_id = s.id
   where s.enabled
     and s.last_ok_at > now() - interval '1 day'
     and coalesce(acc.n, 0) + coalesce(rej.n, 0) <= p_max_items
     and (s.newest_item_at is null or s.newest_item_at < now() - make_interval(days => p_days))
   order by s.name
$function$;
