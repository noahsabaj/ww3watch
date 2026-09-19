-- RPC smoke test. Run against a database built from supabase/migrations (CI does,
-- right after applying them): every function in `public` is CALLED once with
-- realistic arguments, inside a transaction that rolls back.
--
-- Why this exists: plpgsql bodies are not checked when a function is created.
-- purge_irrelevant_articles shipped comparing a TEXT column to a UUID and failed
-- on every call in production; nothing noticed because its caller logs and
-- carries on. Generated TypeScript types cannot see this either (uuid and text
-- are both `string`). Only executing the function does.
--
-- The last block fails if a function exists that this file does not call, so a
-- new RPC cannot be added without a smoke call.

\set ON_ERROR_STOP on
begin;

-- ── fixtures ────────────────────────────────────────────────────────────────
insert into public.sources (id, name, url, region, lang)
values ('00000000-0000-0000-0000-0000000000a1', 'Smoke Wire', 'https://smoke.example/rss', 'US/Western', 'en');

insert into public.articles (id, guid, title, url, feed_url, source_name, source_region, source_lang, source_id, published_at, fetched_at, severity, actors, jev_relevant)
values
  ('00000000-0000-0000-0000-000000000001', 'smoke-1', 'Strike hits port city', 'https://smoke.example/1', 'https://smoke.example/rss', 'Smoke Wire', 'US/Western', 'en', '00000000-0000-0000-0000-0000000000a1', now() - interval '2 hours', now(), 0.7, array['russia','ukraine'], 0.95),
  ('00000000-0000-0000-0000-000000000002', 'smoke-2', 'Port city struck overnight', 'https://smoke.example/2', 'https://smoke.example/rss', 'Smoke Post', 'UK', 'en', null, now() - interval '1 hour', now(), 0.6, array['ukraine'], 0.9),
  ('00000000-0000-0000-0000-000000000003', 'smoke-3', 'Cup final ends in draw', 'https://smoke.example/3', 'https://smoke.example/rss', 'Smoke Wire', 'US/Western', 'en', '00000000-0000-0000-0000-0000000000a1', now() - interval '30 minutes', now(), 0.0, array[]::text[], 0.02),
  ('00000000-0000-0000-0000-000000000004', 'smoke-4', 'Ceasefire talks resume', 'https://smoke.example/4', 'https://smoke.example/rss', 'Smoke Wire', 'US/Western', 'en', '00000000-0000-0000-0000-0000000000a1', now() - interval '20 minutes', now(), 0.2, array['israel'], 0.01);

create temp table smoke_items on commit drop as
select jsonb_agg(jsonb_build_object(
         'id', a.id,
         'published_at', a.published_at,
         'embedding', to_jsonb(array_fill((0.01 * row_number)::real, array[768]))
       ) order by a.published_at) as items
  from (select id, published_at, row_number() over (order by published_at) from public.articles where guid like 'smoke-%') a;

-- ── story grouping ──────────────────────────────────────────────────────────
select count(*) as nearest_rows from public.nearest_story_candidates((select items from smoke_items), 8);
select count(*) as assigned_rows from public.assign_story_by_embedding((select items from smoke_items), 'smoke-model', 0.83, 8);
-- hints: join_story / avoid_story / min_sim must parse
select count(*) as hinted_rows from public.assign_story_by_embedding(
  (select jsonb_agg(i || jsonb_build_object('avoid_story', gen_random_uuid(), 'min_sim', 0.9, 'join_story', null))
     from jsonb_array_elements((select items from smoke_items)) i),
  'smoke-model', 0.83, 8);
select count(*) as join_sims from public.story_join_sims(now() - interval '1 day', 1.0);
select public.reelect_story_reps(array(select id from public.stories)) as reps_reelected;
select public.detach_from_story(array['00000000-0000-0000-0000-000000000002'::uuid]) as detached;

-- ── signals + purge ─────────────────────────────────────────────────────────
select public.apply_article_signals('[{"id":"00000000-0000-0000-0000-000000000001","topic":"armed_conflict","severity":0.67,"claim":0.1,"unverified":0.2,"opinion":0.05,"actors":["russia","ukraine"],"jev_relevant":0.97}]'::jsonb) as signals_applied;

select public.replace_trending(
  '[{"article_id":"00000000-0000-0000-0000-000000000004","story_id":null,"rank":0}]'::jsonb,
  '[{"article_id":"00000000-0000-0000-0000-000000000004","rank":0,"title":"t","source_name":"s","source_region":"r"}]'::jsonb);

-- #3 is purgeable; #4 is just as irrelevant but TRENDING, so it must survive.
do $$
declare n integer;
begin
  n := public.purge_irrelevant_articles(array['00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004']::uuid[]);
  if n <> 1 then raise exception 'purge_irrelevant_articles removed % rows, expected exactly 1 (the non-trending one)', n; end if;
  if not exists (select 1 from public.articles where guid = 'smoke-4') then raise exception 'purge removed a trending article'; end if;
  if not exists (select 1 from public.classified_rejects where guid = 'smoke-3' and reason = 'jev') then raise exception 'purge did not record the reject'; end if;
end $$;

-- ── reporting / ops ─────────────────────────────────────────────────────────
select count(*) as actor_days from public.actor_daily(7);
select count(*) as low_yield from public.source_yield(7, 1, 100);
select count(*) as known_guids from public.existing_guids(array['smoke-1', 'smoke-3', 'never-seen']);
select public.ops_health() is not null as ops_health_ok;
select public.pipeline_status() as pipeline_status;
select public.check_rate_limit('203.0.113.7', 'smoke', 5) as rate_limit_allows;
select public.run_retention() as retention;

-- ── coverage: every public function must be called above ────────────────────
do $$
declare
  covered text[] := array[
    'actor_daily', 'apply_article_signals', 'assign_story_by_embedding', 'check_rate_limit',
    'detach_from_story', 'existing_guids', 'nearest_story_candidates', 'ops_health',
    'pipeline_status', 'purge_irrelevant_articles', 'reelect_story_reps', 'replace_trending',
    'run_retention', 'source_yield', 'story_join_sims',
    -- event-trigger function: fires on DDL, cannot be called directly.
    'rls_auto_enable'
  ];
  missing text;
begin
  select string_agg(p.proname, ', ') into missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.proname <> all(covered);
  if missing is not null then
    raise exception 'public function(s) with no smoke call in supabase/tests/rpc_smoke.sql: %', missing;
  end if;
end $$;

rollback;
