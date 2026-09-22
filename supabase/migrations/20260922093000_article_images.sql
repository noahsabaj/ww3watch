-- Publisher-attached photographs for Signal. image_url is a hotlinked origin
-- URL (RSS media or og:image), never a generated or stock image.
-- image_fetched_at is the fill-stage cursor: NULL means we have not looked yet;
-- a stamp with a NULL url means we looked and the newsroom published none.

ALTER TABLE public.articles
  ADD COLUMN image_url text,
  ADD COLUMN image_width integer,
  ADD COLUMN image_height integer,
  ADD COLUMN image_fetched_at timestamp with time zone;

COMMENT ON COLUMN public.articles.image_url IS
  'Publisher photograph URL (RSS media or og:image). Null until filled or none exists.';

CREATE INDEX articles_image_fill
  ON public.articles (published_at DESC)
  WHERE image_fetched_at IS NULL;
