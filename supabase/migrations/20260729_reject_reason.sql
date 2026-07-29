-- Why a guid is in classified_rejects.
--
-- The table has always meant exactly one thing: "the LLM read this and said no."
-- scripts/calibrate-classify.ts depends on that, loading the whole table as its
-- NEGATIVES class to calibrate the embedding pre-filter floor. Nothing enforced
-- it, so the first bulk write for any other purpose would have silently poisoned
-- that calibration — the floor would be tuned against rows no model ever judged,
-- and the resulting false-reject rate would be wrong in a direction nobody could
-- see. Recording the distinction is what makes the mixed state unrepresentable
-- rather than merely discouraged.
--
-- 'llm'   — a real verdict from a successful classify batch.
-- 'stale' — never judged; written off because it was already too old to surface
--           in a live feed by the time the run reached it. Costs no tokens.
--
-- The CHECK is the point: a future reason must be added here deliberately, which
-- forces whoever adds it to notice the calibration query one file over.
alter table public.classified_rejects
  add column if not exists reason text not null default 'llm';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.classified_rejects'::regclass
      and conname = 'classified_rejects_reason_check'
  ) then
    alter table public.classified_rejects
      add constraint classified_rejects_reason_check
      check (reason in ('llm', 'stale'));
  end if;
end $$;

-- The calibration reads only reason='llm' and the pipeline writes both, so the
-- column is a filter on every access path that matters.
create index if not exists classified_rejects_reason_idx
  on public.classified_rejects (reason);

comment on column public.classified_rejects.reason is
  'llm = a real model verdict (the only rows valid for pre-filter calibration); stale = written off unjudged, too old to display.';
