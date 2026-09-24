-- When a newsroom page (image fill) or photo (photo check) last could not be
-- read. Such a row waits UNREADABLE_RETRY_MINUTES (src/lib/server/config.ts)
-- before the next try instead of being fetched again on every run: at
-- 5-minute runs the same ~60 pages and ~150 photos went through the feed proxy
-- every run, ~60k of its 100k free requests a day (2026-09-24). NULL: never
-- failed.
alter table public.articles
  add column if not exists image_fetch_failed_at timestamptz,
  add column if not exists image_check_failed_at timestamptz;
