\set ON_ERROR_STOP on
-- Restore non-public-schema operational configuration; no outbound calls.
do $$ begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='articles') then alter publication supabase_realtime add table public.articles; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='trending') then alter publication supabase_realtime add table public.trending; end if;
end $$;
select cron.schedule('ww3watch-retention','17 4 * * *','select public.run_retention()');
select cron.schedule('private-retention','17 * * * *','select public.run_private_retention()');
select public.run_private_retention();
