-- Per-article signals, judged once by TypeSafe's Jev at ingest
-- (src/lib/server/jev-signals.ts, vocabulary in src/lib/signals.ts). They route
-- — filter, sort, badge, rank trending — and never alter what a journalist
-- wrote. All nullable: an article without signals renders exactly as before, and
-- the pipeline's worklist (signals_at IS NULL) heals it on a later run.

alter table public.articles
  add column if not exists topic text,
  add column if not exists severity real,
  add column if not exists claim real,
  add column if not exists unverified real,
  add column if not exists opinion real,
  add column if not exists actors text[],
  add column if not exists jev_relevant real,
  add column if not exists signals_at timestamptz;

-- The enrich worklist: recent articles nobody has judged yet.
create index if not exists articles_signals_pending_idx
  on public.articles (fetched_at desc) where signals_at is null;

-- One round-trip per chunk instead of one UPDATE per article. Every row in
-- p_items gets signals_at stamped, including ones whose answers came back
-- partial — the stamp means "asked", so a permanently odd title is not re-asked
-- every 15 minutes forever.
create or replace function public.apply_article_signals(p_items jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  update public.articles a set
    topic = x.topic,
    severity = x.severity,
    claim = x.claim,
    unverified = x.unverified,
    opinion = x.opinion,
    actors = case when x.actors is null then null
                  else array(select jsonb_array_elements_text(x.actors)) end,
    jev_relevant = x.jev_relevant,
    signals_at = now()
  from jsonb_to_recordset(p_items) as x(
    id uuid, topic text, severity real, claim real, unverified real,
    opinion real, actors jsonb, jev_relevant real
  )
  where a.id = x.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.apply_article_signals(jsonb)
  from public, anon, authenticated;
