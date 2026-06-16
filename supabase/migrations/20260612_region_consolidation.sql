-- PR-B: consolidate the region taxonomy. Iran was the only country whose
-- state/independent split masqueraded as GEOGRAPHY — three buckets ('Iranian
-- State'/'Iranian Independent'/'Iranian Local') where every other country had
-- one. With sources.affiliation now carrying that distinction consistently,
-- collapse the three into a single geographic 'Iranian'. Also move the Taiwanese
-- outlets out of 'Chinese' (they are not PRC media) into the existing 'East
-- Asian' bucket.
--
-- ⚠️ DEPLOY SKEW — apply this ONLY AFTER the new bundle (with the consolidated
-- REGIONS const) is live on Pages. It changes filter buckets: the live client's
-- activeRegions set is built from its compiled REGIONS, so applying before the
-- new bundle ships would hide every 'Iranian' row from current users. Apply
-- post-deploy. The sources region UPDATE also races the pipeline's full-row
-- health upsert (which carries region) — apply when no pipeline run is in flight,
-- then confirm it stuck.

-- Sources: collapse Iranian* and move Taiwan.
update public.sources set region = 'Iranian'
 where region in ('Iranian State','Iranian Independent','Iranian Local');
update public.sources set region = 'East Asian'
 where name in ('Taiwan News','Taipei Times','Focus Taiwan');

-- Articles: backfill the denormalized region so already-ingested rows match the
-- new buckets (Taiwan keyed by source_name since they currently share 'Chinese').
update public.articles set source_region = 'Iranian'
 where source_region in ('Iranian State','Iranian Independent','Iranian Local');
update public.articles set source_region = 'East Asian'
 where source_name in ('Taiwan News','Taipei Times','Focus Taiwan');
