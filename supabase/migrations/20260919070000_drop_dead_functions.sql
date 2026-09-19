-- relevant_centroid(p_days) served the June "classify shadow" prefilter, which
-- the local relevance head replaced. Nothing calls it (src, scripts, functions).
drop function if exists public.relevant_centroid(integer);
-- The pre-stories clusterer's RPC; superseded by assign_story_by_embedding and
-- already absent from prod — dropped here so a rebuilt database matches.
drop function if exists public.assign_clusters_by_embedding(jsonb, text, real, int);
