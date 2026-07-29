-- BASELINE: articles + trending.
--
-- These two tables — the ones the entire frontend reads — were created by hand
-- in the dashboard before this repo kept migrations, so every later migration
-- only ever ALTERed them. The consequence was that `supabase/migrations/` could
-- not rebuild the database: applying the whole set to an empty Postgres failed
-- on the first `alter table public.articles`, and nothing in the repo recorded
-- these columns, their RLS, or their realtime membership. The README papered
-- over it with prose ("Enable RLS on articles and trending with policies
-- allowing anon SELECT"); the schema now carries it.
--
-- Dated before the earliest real migration (20260609) so it applies FIRST on a
-- fresh database. Every statement is idempotent, so against the existing
-- production database this migration is a verified no-op.
--
-- Transcribed from the live project (columns, nullability, defaults, indexes,
-- policies, publication), NOT from the TypeScript types — where the two
-- disagree, the database is what the app actually runs against.
--
-- Columns added by later migrations are deliberately ABSENT here: body_hash
-- (20260611_body_hash), source_id (20260611_sources), story_id (20260611_stories),
-- source_affiliation (20260612_affiliation). Same for articles_url_idx
-- (20260610_article_cache). The history stays truthful about what arrived when.

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  guid text unique not null,
  title text not null,
  url text not null,
  summary text,
  published_at timestamptz,
  -- ACCIDENT, PRESERVED: nullable despite `Article.fetched_at: string` in
  -- src/lib/types.ts. The default has always covered it because nothing inserts
  -- an explicit null. Worth knowing that a null here would make a row
  -- permanently invisible to the clustering self-heal worklist, which filters
  -- `.gte('fetched_at', since)` (scripts/run-pipeline.ts). Tightening it to NOT
  -- NULL is a separate decision, not part of recording what exists.
  fetched_at timestamptz default now(),
  source_name text not null,
  source_region text not null,
  -- ACCIDENT, PRESERVED: nullable despite `Article.source_lang: string`. Same
  -- reasoning as fetched_at — the default carries it.
  source_lang text default 'en',
  feed_url text not null,
  -- LEGACY, and dropped again by 20260618_drop_cluster_id_mirror.sql. It has to
  -- exist here because 20260611_stories.sql's backfill reads it — that migration
  -- could not run on a fresh database without it. Recreating it and then
  -- dropping it reproduces the real history and lands on the same final schema.
  cluster_id text
);

-- ACCIDENT, PRESERVED: article_id is TEXT while articles.id is UUID, and there
-- is no foreign key between them. It works because PostgREST coerces on the way
-- in and the client only ever compares strings. Changing the type would rewrite
-- the trending contract that N-1 PWA clients still resolve by article_id
-- (see docs/CONVENTIONS.md, "Deploy skew"), so it is recorded as-is here and
-- left alone.
create table if not exists public.trending (
  article_id text primary key,
  rank smallint not null,
  selected_at timestamptz not null default now()
);

-- The feed's ordering (published_at DESC, fetched_at DESC) and its region /
-- language filters. NOTE: there is deliberately no index on story_id — prod has
-- none either, and adding one here would make a rebuilt database diverge from
-- the real one. Whether it should exist is a separate question worth asking.
create index if not exists articles_published_at_idx on public.articles (published_at desc);
create index if not exists articles_fetched_at_idx on public.articles (fetched_at desc);
create index if not exists articles_source_region_idx on public.articles (source_region);
create index if not exists articles_source_lang_idx on public.articles (source_lang);

-- Public read, service-role write. The SPA and its realtime subscription read
-- with the anon key; nothing anonymous ever writes.
alter table public.articles enable row level security;
drop policy if exists "Public can read articles" on public.articles;
create policy "Public can read articles" on public.articles for select using (true);

alter table public.trending enable row level security;
drop policy if exists "Public can read trending" on public.trending;
create policy "Public can read trending" on public.trending for select using (true);

-- Realtime: the client subscribes to postgres_changes on articles (INSERT for
-- the live feed, filtered UPDATE for cluster re-assignment). Guarded the same
-- way 20260611_trending_realtime.sql guards trending, which is a no-op when
-- this baseline has already added it.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'articles'
  ) then
    alter publication supabase_realtime add table public.articles;
  end if;
end $$;

-- ── The auto-RLS safety net ──────────────────────────────────────────────────
-- Also created outside the migration set. It matters more than it looks: any
-- new public table gets RLS enabled automatically, so a table added without an
-- explicit `enable row level security` is still protected. A database rebuilt
-- from migrations alone would have silently lacked that, and the next migration
-- (20260609_revoke_rls_auto_enable_execute.sql) revokes EXECUTE on a function
-- that would not have existed — which is how this gap first showed up.
--
-- Transcribed verbatim from the live project, including its `search_path =
-- pg_catalog` (the repo convention elsewhere is `search_path = ''`; this one
-- predates the convention and is left as it runs).
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog','information_schema') and cmd.schema_name not like 'pg\_toast%' and cmd.schema_name not like 'pg\_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$function$;

-- CREATE EVENT TRIGGER needs superuser. Hosted Supabase and the local stack both
-- run migrations as one, but a self-hosted deploy might not — warn rather than
-- fail the whole migration, since every table in this repo also enables RLS
-- explicitly and this is defence in depth.
do $$ begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    begin
      create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
    exception when insufficient_privilege then
      raise warning 'could not create the ensure_rls event trigger (needs superuser) — new tables will NOT get RLS automatically; enable it explicitly on each';
    end;
  end if;
end $$;
