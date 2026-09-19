-- The pipeline no longer has an LLM classifier: relevance is the local head, then
-- TypeSafe's Jev, whose verdict is final. classified_rejects.reason defaulted to
-- 'llm' from the days when that was the only writer; a row written without a
-- reason would now be attributed to a judge that does not exist.
--
-- 'llm' stays in the CHECK: historical rows live out their 14-day retention, and
-- scripts/train-classifier.ts still reads them as negatives until they are gone.

alter table public.classified_rejects alter column reason set default 'jev';

comment on column public.classified_rejects.reason is
  'Who said no: jev (TypeSafe Jev verdict), head (local relevance head, never trained on), stale (written off unjudged, too old to display), llm (historical: the retired LLM classifier).';
