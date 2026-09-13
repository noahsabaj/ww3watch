-- Service-only tables: drop the anon/authenticated grants entirely.
--
-- 20260607_baseline_role_grants gives every public table `grant all` to anon
-- and authenticated (and the schema's default privileges keep doing so for new
-- tables). RLS with zero policies hides the rows, so nothing leaks today — but
-- the grant is what makes these tables enumerable through GraphQL/PostgREST
-- introspection (advisor 0026/0027), and it means a single mistaken
-- `create policy` would expose them. Revoking the grant removes the row-level
-- policy as the only line of defence.
--
-- trending_log is NOT here: /about reads it with the anon key under an explicit
-- select policy. Public tables (articles, trending, sources) keep their grants.
--
-- New service-only tables need the same revoke — the default privileges will
-- have granted anon/authenticated again.

revoke all on table
  public.article_content,
  public.article_embeddings,
  public.article_translations,
  public.classified_rejects,
  public.pipeline_runs,
  public.rate_limits,
  public.stories
from anon, authenticated;

-- Unindexed foreign keys (advisor 0001): every UPDATE/DELETE on sources scans
-- both tables to check the constraint, and the curation queries join on them.
create index if not exists articles_source_id_idx on public.articles (source_id);
create index if not exists classified_rejects_source_id_idx on public.classified_rejects (source_id);
