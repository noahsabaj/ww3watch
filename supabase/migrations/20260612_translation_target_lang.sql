-- PR-D2: translations can target any reading language, not just English. Add the
-- target language to the cache row (existing rows are all English → default 'en'
-- is correct). The cache KEY (input_hash) stays backward-compatible: English
-- requests keep the original [lang, title, content] hash so the entire existing
-- English cache is reused; other targets get a distinct [lang, target, title,
-- content] namespace (see supabase/functions/_shared/lang.ts translationCacheParts).
alter table public.article_translations add column if not exists target_lang text not null default 'en';
