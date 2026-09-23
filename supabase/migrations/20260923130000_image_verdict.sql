-- A newsroom's image is shown only once the pipeline has looked at it
-- (src/lib/server/pipeline/photo-check.ts). Feeds attach logos, emblems and
-- house graphics as if they were photographs, and one outlet can put the same
-- picture on every story it files; neither says anything about the story.
--   image_verdict: NULL = not looked at yet (the site shows no photo);
--                  'photo'  = a photograph, shown;
--                  'emblem' = a logo, seal or emblem, never shown;
--                  'reused' = the same picture on 3+ different stories, never shown.
--   image_hash:    64-bit difference hash of the picture, for spotting reuse.

ALTER TABLE public.articles
  ADD COLUMN image_verdict text CHECK (image_verdict IN ('photo', 'emblem', 'reused')),
  ADD COLUMN image_hash text;

COMMENT ON COLUMN public.articles.image_verdict IS
  'Photo check result: NULL unchecked (not shown), photo (shown), emblem or reused (never shown).';
COMMENT ON COLUMN public.articles.image_hash IS
  'Difference hash of the image, for finding the same picture across stories.';

-- The check stage's worklist, and its reuse lookups.
CREATE INDEX articles_image_unchecked
  ON public.articles (published_at DESC)
  WHERE image_url IS NOT NULL AND image_verdict IS NULL;
CREATE INDEX articles_image_hash
  ON public.articles (image_hash)
  WHERE image_hash IS NOT NULL;
