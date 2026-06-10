-- Track articles the LLM judged irrelevant so we never re-classify them.
-- Before this, rejected articles were never recorded → "not in articles" = "new"
-- → re-classified every 15-minute run forever (~85-90% of LLM calls wasted).

create table if not exists public.classified_rejects (
  guid text primary key,
  rejected_at timestamptz not null default now()
);

-- Service-role only: RLS on, no policies. Never exposed to anon/authenticated.
alter table public.classified_rejects enable row level security;

-- Single-RPC dedup: which of these guids already exist (as kept articles OR
-- recorded rejects)? Replaces the chunked .in('guid', ...) GET loop (URL-length
-- limits + transient-timeout multiplication). SECURITY INVOKER (default) + the
-- RLS-without-policies above means an anon caller sees zero reject rows.
-- search_path pinned per advisor.
create or replace function public.existing_guids(check_guids text[])
returns table (guid text)
language sql
security invoker
set search_path = ''
as $$
  select a.guid from public.articles a where a.guid = any(check_guids)
  union
  select r.guid from public.classified_rejects r where r.guid = any(check_guids)
$$;

-- HISTORICAL NOTE: this revoke was incomplete. This database's per-schema
-- default privileges ADD to PostgreSQL's built-in PUBLIC execute grant on new
-- functions, and revoking from anon/authenticated does NOT remove the PUBLIC
-- entry they inherit through — the function stayed anon-callable until
-- 20260611_article_embeddings.sql added `revoke ... from public`. New
-- functions must always revoke `from public, anon, authenticated` (cf.
-- 20260609_revoke_rls_auto_enable_execute.sql, which got it right).
revoke execute on function public.existing_guids(text[]) from anon, authenticated;
