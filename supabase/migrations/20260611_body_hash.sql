-- Wire-syndication detection: hash of the normalized summary. Outlets
-- reprinting the same wire copy share a hash; "N sources" can then be honest
-- about independent reporting vs syndication. Normalization lives in ONE
-- TypeScript function (src/lib/server/wire.ts) — the backfill reuses it; no
-- SQL reimplementation (drift would poison comparisons).
alter table public.articles add column if not exists body_hash text;
