-- Live trending: the client now subscribes to postgres_changes on trending
-- (the pipeline rewrites it delete-all + insert-3 each run) and refetches the
-- selection on any event. The publication previously contained only articles.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trending'
  ) then
    alter publication supabase_realtime add table public.trending;
  end if;
end $$;
