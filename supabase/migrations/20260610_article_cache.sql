-- Cache extracted article content + translations. Repeat opens become instant,
-- LLM/proxy load drops, and cached content survives source-page takedowns — a
-- real archive benefit for war reporting (link rot is frequent).
--
-- Content is stored UNsanitized: the client sanitizes with DOMPurify at render,
-- so sanitizer upgrades apply retroactively to cached rows.
--
-- Both edge functions are public (verify_jwt off); writes are gated server-side
-- to URLs that exist in articles.url so the cache can't be attacker-filled.

create table if not exists public.article_content (
  url text primary key,
  title text not null default '',
  byline text,
  content text not null,
  site_name text,
  fetched_at timestamptz not null default now()
);

create table if not exists public.article_translations (
  input_hash text primary key,
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);

-- Service-role only (edge functions); never exposed to anon.
alter table public.article_content enable row level security;
alter table public.article_translations enable row level security;

-- Gate lookups join on articles.url, which had no index.
create index if not exists articles_url_idx on public.articles (url);
