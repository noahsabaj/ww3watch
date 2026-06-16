-- PR-A: per-source attribution on rejects. The sources health table measures
-- only fetch mechanics (HTTP/parse failures) — never whether a feed's content is
-- ever relevant. With source_id + lang on rejects, the feed-curation pass can
-- compute accept-rate (accepted/(accepted+rejected)) per source and per language
-- and spot feeds that are mostly noise burning classify tokens every run.
-- Service-only table (RLS on, no policies) — no new exposure.
alter table public.classified_rejects
  add column if not exists source_id uuid references public.sources(id) on delete set null,
  add column if not exists lang text;
