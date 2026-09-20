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

-- ── story merge ─────────────────────────────────────────────────────────────
-- Two stories, one article each, identical embeddings → a candidate pair; merging
-- must move the member, repoint trending, delete the emptied story.
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  moved integer;
begin
  update public.articles set story_id = null where guid in ('smoke-1', 'smoke-2');
  insert into public.stories (id, rep_article_id) values
    (a, '00000000-0000-0000-0000-000000000001'), (b, '00000000-0000-0000-0000-000000000002');
  update public.articles set story_id = a where guid = 'smoke-1';
  update public.articles set story_id = b where guid = 'smoke-2';
  update public.article_embeddings set embedding = (select embedding from public.article_embeddings where article_id = '00000000-0000-0000-0000-000000000001')
   where article_id = '00000000-0000-0000-0000-000000000002';
  if not exists (select 1 from public.story_merge_candidates(24, 0.8::real, 50) c where (c.r_a, c.r_b) in ((a, b), (b, a))) then
    raise exception 'story_merge_candidates did not return the identical-embedding pair';
  end if;
  moved := public.merge_stories(b, a);
  if moved <> 1 then raise exception 'merge_stories moved % articles, expected 1', moved; end if;
  if exists (select 1 from public.stories where id = b) then raise exception 'merge_stories left the emptied story behind'; end if;
  if (select article_count from public.stories where id = a) <> 2 then raise exception 'merge_stories did not recompute article_count'; end if;
  if public.merge_stories(a, a) <> 0 then raise exception 'merging a story into itself must be a no-op'; end if;
end $$;

-- ── verdicts ────────────────────────────────────────────────────────────────
insert into public.verdicts (guid, judge, decision, p, threshold, model, lang)
values ('smoke-1', 'jev', 'accept', 0.97, 0.5, 'smoke', 'en'), ('smoke-3', 'head', 'reject', 0.04, 0.28, 'smoke', 'en'), ('smoke-x', 'stale', 'reject', null, null, null, 'en');
select count(*) as verdict_days from public.verdict_daily;

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

-- Private operations: every RPC executes and privacy privileges stay closed.
do $$
declare reservation jsonb; rid uuid;
begin
  if public.reserve_ai('translation','test-model',10,10)->>'error' <> 'pricing_unverified' then raise exception 'unknown pricing allowed'; end if;
  update public.ai_budgets set model='test-model',input_per_million=1,output_per_million=1,pricing_verified_at=now(),max_concurrent=1 where service='translation';
  insert into public.ai_months(service,month,opening_verified_at) values('translation',date_trunc('month',now() at time zone 'UTC')::date,now()) on conflict(service,month) do update set opening_verified_at=excluded.opening_verified_at;
  reservation := public.reserve_ai('translation','test-model',100,100);
  rid := (reservation->>'id')::uuid;
  if rid is null then raise exception 'reservation failed: %',reservation; end if;
  if public.reserve_ai('translation','test-model',100,100)->>'error' <> 'busy' then raise exception 'concurrency cap bypassed'; end if;
  perform public.settle_ai(rid,10,10);
  perform public.settle_ai(rid,0,0);
  if (select charged_usd from public.ai_months where service='translation') <> 0.00002 then raise exception 'settlement was not idempotent'; end if;
  if public.reserve_ai('translation','test-model',4000000,0)->>'error' <> 'budget_exhausted' then raise exception 'budget cap bypassed'; end if;
  if not public.submit_report('problem','Marked smoke test report',null,null,'smoke-report') then raise exception 'report failed'; end if;
  perform public.submit_report('problem','Marked smoke test report',null,null,'smoke-report');
  if (select count(*) from public.visitor_reports where fingerprint='smoke-report') <> 1 then raise exception 'duplicate report'; end if;
  if has_table_privilege('anon','public.visitor_reports','SELECT') or has_function_privilege('anon','public.reserve_ai(text,text,integer,integer)','EXECUTE') then raise exception 'private data publicly accessible'; end if;
  insert into public.rate_limits(ip,fn,window_start,count) values('expired','smoke',now()-interval '3 days',1);
  perform public.run_private_retention();
  if exists(select 1 from public.rate_limits where ip='expired') then raise exception 'expired identifiers retained'; end if;
end $$;

-- Source health must not overwrite curation or replay stale snapshots.
do $$
declare sid uuid := '00000000-0000-0000-0000-0000000000a1'; snapshot timestamptz; batch jsonb; n integer;
begin
  select updated_at into snapshot from public.sources where id=sid;
  batch := jsonb_build_array(jsonb_build_object('id',sid,'url','https://smoke.example/rss',
    'observed_updated_at',snapshot,'ok',false,'via','proxy','error_kind','http','error_detail','HTTP 403'));
  select count(*) into n from public.record_source_health(batch,2);
  if n <> 1 or (select consecutive_failures from public.sources where id=sid) <> 1 then raise exception 'health update failed'; end if;
  select count(*) into n from public.record_source_health(batch,2);
  if n <> 0 then raise exception 'replayed health result applied'; end if;
  select updated_at into snapshot from public.sources where id=sid;
  batch := jsonb_set(batch,'{0,observed_updated_at}',to_jsonb(snapshot));
  update public.sources set url='https://smoke.example/new',name='Curated name' where id=sid;
  select count(*) into n from public.record_source_health(batch,2);
  if n <> 0 or (select name from public.sources where id=sid) <> 'Curated name' then raise exception 'health overwrote curation'; end if;
  batch := jsonb_set(batch,'{0,url}',to_jsonb('https://smoke.example/new'::text));
  select count(*) into n from public.record_source_health(batch,2) where disabled;
  if n <> 1 or (select enabled from public.sources where id=sid) then raise exception 'auto-disable failed'; end if;
  select updated_at into snapshot from public.sources where id=sid;
  batch := jsonb_set(jsonb_set(batch,'{0,observed_updated_at}',to_jsonb(snapshot)),'{0,ok}','true');
  select count(*) into n from public.record_source_health(batch,2);
  if n <> 0 or (select enabled from public.sources where id=sid) then raise exception 'disabled source re-enabled'; end if;
  update public.sources set enabled=true,updated_at=clock_timestamp() where id=sid;
  select updated_at into snapshot from public.sources where id=sid;
  batch := jsonb_set(batch,'{0,observed_updated_at}',to_jsonb(snapshot));
  perform public.record_source_health(batch,2);
  if (select consecutive_failures from public.sources where id=sid) <> 0
     or (select last_error from public.sources where id=sid) is not null then raise exception 'recovery not recorded'; end if;
  if has_function_privilege('anon','public.record_source_health(jsonb,integer)','EXECUTE')
     or has_function_privilege('authenticated','public.record_source_health(jsonb,integer)','EXECUTE') then raise exception 'public health writes allowed'; end if;
end $$;

-- ── coverage: every public function must be called above ────────────────────
do $$
declare
  covered text[] := array[
    'actor_daily', 'apply_article_signals', 'assign_story_by_embedding', 'check_rate_limit',
    'detach_from_story', 'existing_guids', 'nearest_story_candidates', 'ops_health',
    'pipeline_status', 'purge_irrelevant_articles', 'reelect_story_reps', 'replace_trending',
    'run_retention', 'source_yield', 'story_join_sims', 'story_merge_candidates', 'merge_stories',
    -- event-trigger function: fires on DDL, cannot be called directly.
    'rls_auto_enable', 'reserve_ai', 'settle_ai', 'submit_report', 'run_private_retention', 'record_source_health'
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
