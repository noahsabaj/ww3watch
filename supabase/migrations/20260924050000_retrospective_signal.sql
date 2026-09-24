-- Jev's "looks back" judgment (src/lib/server/jev-signals.ts): P(the report is
-- chiefly about something long ago -- history, an anniversary, a new study of
-- an old event). Severity rates the event a report describes whenever it
-- happened, so a look back at the 1980 invasion of Iran scored 0.99; a report
-- that looks back is never "major" (src/lib/signals.ts, eventSeverity).
-- Additive: rows annotated before it stay null and read as not looking back.
alter table public.articles add column if not exists retrospective real;

create or replace function public.apply_article_signals(p_items jsonb) returns integer
    language plpgsql
    set search_path to ''
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
    retrospective = x.retrospective,
    actors = case when x.actors is null then null
                  else array(select jsonb_array_elements_text(x.actors)) end,
    jev_relevant = x.jev_relevant,
    signals_at = now()
  from jsonb_to_recordset(p_items) as x(
    id uuid, topic text, severity real, claim real, unverified real,
    opinion real, retrospective real, actors jsonb, jev_relevant real
  )
  where a.id = x.id;
  get diagnostics n = row_count;
  return n;
end;
$$;
