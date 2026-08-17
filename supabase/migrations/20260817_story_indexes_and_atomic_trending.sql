-- Performance indexes on foreign keys and atomic trending replacement RPC.

-- 1. Foreign key index on articles.story_id.
-- Resolves sequential table scans during assign_story_by_embedding clustering
-- (count(*) from articles where story_id = sid) and run_retention.
create index if not exists articles_story_id_idx on public.articles (story_id);

-- 2. Foreign key index on stories.rep_article_id.
create index if not exists stories_rep_article_id_idx on public.stories (rep_article_id);

-- 3. Foreign key index on trending.story_id.
create index if not exists trending_story_id_idx on public.trending (story_id);

-- 4. Composite index on classified_rejects (rejected_at, reason) for retention and calibration queries.
create index if not exists classified_rejects_rejected_at_reason_idx on public.classified_rejects (rejected_at, reason);

-- 5. Atomic trending replacement RPC: executes delete, insert, and trending_log trail append
-- in a single Postgres transaction, eliminating the race condition / zero-row window.
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
  -- Clear current trending rows
  delete from public.trending;

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
