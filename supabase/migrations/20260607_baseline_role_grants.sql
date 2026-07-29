-- BASELINE (part 1 of 2): the PostgREST role grants.
--
-- Every public table in production carries `grant all` to anon, authenticated
-- and service_role. That is Supabase's project bootstrap, not something any
-- migration in this repo ever stated — so a database rebuilt from migrations had
-- the right tables, the right RLS and the right policies, and PostgREST still
-- answered `permission denied for table articles` to the anon key. Row-level
-- policies do not grant table-level privileges; both are required.
--
-- This was found by pointing the e2e suite at a freshly migrated database. The
-- earlier schema baseline diffed columns, indexes, policies and publication
-- membership against production and matched on all four — grants were the fifth
-- thing, and nothing was comparing them.
--
-- ACCESS IS STILL CONTROLLED BY RLS, NOT BY THESE GRANTS. Every table has RLS
-- enabled; service-only tables (stories, article_embeddings, classified_rejects,
-- rate_limits, article_content, article_translations, pipeline_runs) carry ZERO
-- policies, so anon reaches nothing through them regardless of the grant. The
-- public ones carry an explicit `for select using (true)`. Granting less than
-- production does here would be worse, not better: local would stop reproducing
-- prod, and "works on my machine" failures are exactly what this baseline exists
-- to prevent. Tighten it in production first, then mirror it here.
--
-- Dated before the table baseline so the default privileges are in place as each
-- table is created; the explicit grants at the end cover anything that already
-- existed. Idempotent, so this is a no-op against production.

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Applies to tables created AFTER this point by the migration runner's role.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- And catch anything already present (production, or a re-run).
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
