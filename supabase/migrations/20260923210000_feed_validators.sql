-- Conditional feed requests (src/lib/server/rss.ts): each source keeps the
-- ETag / Last-Modified of its last full response, and the next run sends them
-- back as If-None-Match / If-Modified-Since. A feed that has not changed
-- answers 304 and is neither downloaded nor parsed. ~40% of the roster
-- supports it (69 of 169 feeds, 2026-09-23).
alter table public.sources
  add column if not exists feed_etag text,
  add column if not exists feed_last_modified text;

-- record_source_health also stores the validators: a successful fetch (200 or
-- 304) writes what the pipeline will send next (null when the feed sent none);
-- a failure keeps the stored pair. Everything else is unchanged from
-- 20260920174120_source_health_curation_guard.sql.
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
      enabled = case when not r.ok and s.consecutive_failures + 1 >= p_disable_after then false else s.enabled end,
      updated_at = clock_timestamp()
    from jsonb_to_recordset(p_results) as r(id uuid, url text, observed_updated_at timestamptz, ok boolean, via text, error_kind text, error_detail text, etag text, last_modified text)
    where s.id = r.id and s.url = r.url and s.enabled and s.updated_at = r.observed_updated_at
    returning s.id, s.name, not s.enabled as disabled
  ) select c.id, c.name, c.disabled from changed as c;
end;
$function$;
