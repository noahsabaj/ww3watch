-- The feed's first page and "Load older" read articles newest first
-- (published_at DESC NULLS LAST, fetched_at DESC). Without a matching index
-- every page load sorted all ~31k rows: a sequential scan plus top-N sort,
-- 39ms warm (EXPLAIN ANALYZE as anon, 2026-09-23). The index walks the order
-- directly and stops after the page.
create index if not exists articles_feed_order
  on public.articles (published_at desc nulls last, fetched_at desc);
