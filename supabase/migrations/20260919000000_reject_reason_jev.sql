-- classified_rejects.reason gains 'jev': rejected by TypeSafe's Jev, the routing
-- tier between the local head and the LLM (src/lib/server/jev-classify.ts).
--
-- Distinct from 'llm' so who said no stays on the record, and from 'head'
-- because scripts/train-classifier.ts DOES train on these: Jev is an
-- independent model, so its rejects are not the head's own mistakes fed back.

alter table public.classified_rejects
  drop constraint if exists classified_rejects_reason_check;
alter table public.classified_rejects
  add constraint classified_rejects_reason_check
  check (reason in ('llm', 'stale', 'head', 'jev'));
