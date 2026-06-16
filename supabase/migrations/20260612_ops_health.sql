-- PR-C: operator-facing health snapshot read once per pipeline run. The
-- retention cron reports only into cron.job_run_details (which it then prunes
-- after 7 days), and DB size has no watcher — so a silently-broken retention job
-- grows the DB ~900 rows/day until the free tier's 500MB cap makes it read-only,
-- killing ingestion + reader cache + rate limiting at once. This surfaces both so
-- the pipeline can warn (>400MB / retention stale >48h) and hard-fail (>450MB),
-- which routes to the GitHub-issue alerting step. security definer (owner reads
-- the cron schema + pg_database_size); service-role only.
create or replace function public.ops_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'db_size_mb', round((pg_database_size(current_database()) / 1048576.0)::numeric, 1),
    'retention_last_status', (
      select jrd.status from cron.job_run_details jrd
        join cron.job j on j.jobid = jrd.jobid
       where j.jobname = 'ww3watch-retention'
       order by jrd.end_time desc nulls last limit 1),
    'retention_last_at', (
      select jrd.end_time from cron.job_run_details jrd
        join cron.job j on j.jobid = jrd.jobid
       where j.jobname = 'ww3watch-retention'
       order by jrd.end_time desc nulls last limit 1)
  );
$$;

revoke execute on function public.ops_health() from public, anon, authenticated;
