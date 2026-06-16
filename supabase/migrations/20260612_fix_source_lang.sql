-- PR-D2: two feeds were mislabeled 'en' but publish in their own language —
-- Ynet News is the Hebrew ynet.co.il feed; Yemen Monitor publishes in Arabic.
-- The wrong lang (a) defeated the same-language translate guard (you could
-- "translate" Hebrew→Hebrew), and (b) told the LLM to translate "from English"
-- on non-English text. Correct the roster + backfill existing articles
-- (by source_name, which is reliably denormalized on every row).
-- NOTE: a fuller per-feed language audit belongs to the feed-curation pass; this
-- fixes the two script-detectable mislabels.
update public.sources set lang = 'he' where name = 'Ynet News';
update public.sources set lang = 'ar' where name = 'Yemen Monitor';
update public.articles set source_lang = 'he' where source_name = 'Ynet News';
update public.articles set source_lang = 'ar' where source_name = 'Yemen Monitor';
