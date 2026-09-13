-- classified_rejects.reason gains 'head': rejected by the local relevance head
-- (src/lib/server/prefilter.ts) without an LLM call.
--
-- Kept distinct from 'llm' on purpose. scripts/train-classifier.ts loads
-- reason='llm' rows as its NEGATIVES — the LLM's own verdicts. Training on the
-- head's rejects would teach the head its own mistakes (and drift: each
-- generation more confident about whatever the last one rejected). The audit
-- slice the pipeline still sends to the LLM is how head rejects get checked;
-- those verdicts land as 'llm' rows and feed the next training run.

alter table public.classified_rejects
  drop constraint if exists classified_rejects_reason_check;
alter table public.classified_rejects
  add constraint classified_rejects_reason_check
  check (reason in ('llm', 'stale', 'head'));
