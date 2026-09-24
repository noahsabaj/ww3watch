-- The photo check's trained head (src/lib/server/pipeline/photo-head.ts) calls
-- anything that is not a photograph a 'graphic': logos and emblems as before,
-- and also TV and quote cards, maps, composites and front pages. Rows judged
-- before it keep 'emblem'. Neither is ever shown.
ALTER TABLE public.articles DROP CONSTRAINT articles_image_verdict_check;
ALTER TABLE public.articles
  ADD CONSTRAINT articles_image_verdict_check CHECK (image_verdict IN ('photo', 'graphic', 'emblem', 'reused'));

COMMENT ON COLUMN public.articles.image_verdict IS
  'Photo check result: NULL unchecked (not shown), photo (shown), graphic, emblem (before 2026-09-24) or reused (never shown).';
