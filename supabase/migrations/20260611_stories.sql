-- Story-first model: stories become first-class rows; articles carry a real
-- uuid FK instead of the id-as-text cluster_id convention. The legacy
-- cluster_id column keeps being MIRRORED by the new RPC until the cleanup
-- migration (deploy skew: PWA autoUpdate keeps N-1 clients alive ~a session).

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_article_at timestamptz not null default now(),
  article_count int not null default 1,
  source_count int not null default 1,
  region_count int not null default 1,
  -- Star-linkage center. Nullable + SET NULL: retention may prune the rep
  -- while later members survive; a null-rep story simply stops being an
  -- assignment candidate (the candidate query joins through it).
  rep_article_id uuid references public.articles(id) on delete set null
);

-- Service-only (RLS on, no policies): the client only ever needs
-- articles.story_id, which arrives on article rows + realtime UPDATEs.
alter table public.stories enable row level security;

alter table public.articles
  add column if not exists story_id uuid references public.stories(id) on delete set null;

alter table public.trending add column if not exists story_id uuid;

-- Idempotent legacy backfill: one story per cluster_id group. Re-run after
-- the pipeline code deploys to sweep rows assigned by RPC v2 during the
-- migration→deploy gap. If part of a group already has a story (v3 joined new
-- members to it), ADOPT that story instead of creating a duplicate.
create or replace function public.backfill_stories()
returns text
language plpgsql
set search_path = ''
as $$
declare
  grp record;
  sid uuid;
  made int := 0;
  adopted int := 0;
begin
  for grp in
    select a.cluster_id
      from public.articles a
     where a.cluster_id is not null
       and a.story_id is null
     group by a.cluster_id
  loop
    select a.story_id into sid
      from public.articles a
     where a.cluster_id = grp.cluster_id and a.story_id is not null
     limit 1;

    if sid is null then
      insert into public.stories
        (created_at, last_article_at, article_count, source_count, region_count, rep_article_id)
      select coalesce(min(a.published_at), now()),
             coalesce(max(a.published_at), now()),
             count(*),
             count(distinct a.source_name),
             count(distinct a.source_region),
             (select r.id from public.articles r where r.id::text = grp.cluster_id)
        from public.articles a
       where a.cluster_id = grp.cluster_id
      returning id into sid;
      made := made + 1;
    else
      adopted := adopted + 1;
    end if;

    update public.articles
       set story_id = sid
     where cluster_id = grp.cluster_id and story_id is null;

    update public.stories s
       set article_count = m.n,
           source_count = m.ns,
           region_count = m.nr,
           last_article_at = m.last_at
      from (select count(*) as n,
                   count(distinct source_name) as ns,
                   count(distinct source_region) as nr,
                   coalesce(max(published_at), now()) as last_at
              from public.articles
             where story_id = sid) m
     where s.id = sid;
  end loop;
  return format('stories_created=%s adopted=%s', made, adopted);
end;
$$;

revoke execute on function public.backfill_stories() from public, anon, authenticated;

select public.backfill_stories();

-- Assignment RPC v3: story-native. v2 (assign_clusters_by_embedding) is kept
-- until the cleanup migration — scheduled pipeline runs in the migration→
-- deploy gap still call it.
create or replace function public.assign_story_by_embedding(
  p_items jsonb,          -- [{"id": uuid, "published_at": ts|null, "embedding": [768 floats]}, ...] chronological ASC
  p_model text,
  p_threshold real,       -- cosine SIMILARITY floor (1 - distance)
  p_window_hours int
) returns table (r_article_id uuid, r_story_id uuid, r_is_new boolean)
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  item_id uuid;
  item_ts timestamptz;
  v extensions.vector(768);
  w interval;
  best_story uuid;
  best_sim real;
  sid uuid;
  was_new boolean;
  rep_text text;
begin
  w := make_interval(hours => p_window_hours);

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := (item->>'id')::uuid;
    item_ts := coalesce((item->>'published_at')::timestamptz, now());
    v := (item->>'embedding')::extensions.vector(768);

    insert into public.article_embeddings (article_id, embedding, model)
    values (item_id, v, p_model)
    on conflict (article_id)
      do update set embedding = excluded.embedding, model = excluded.model;

    -- Nearest story REPRESENTATIVE within the item-relative window (exact
    -- scan; the window keeps the candidate set tiny). Window anchors on the
    -- rep's published_at — parity with the v2 behavior.
    select s.id, 1 - (ae.embedding operator(extensions.<=>) v)
      into best_story, best_sim
      from public.stories s
      join public.articles rep on rep.id = s.rep_article_id
      join public.article_embeddings ae on ae.article_id = rep.id
     where rep.id <> item_id
       and rep.published_at between item_ts - w and item_ts + w
     order by ae.embedding operator(extensions.<=>) v
     limit 1;

    if best_sim is not null and best_sim >= p_threshold then
      sid := best_story;
      was_new := false;
    else
      insert into public.stories (created_at, last_article_at, rep_article_id)
      values (item_ts, item_ts, item_id)
      returning id into sid;
      was_new := true;
    end if;

    -- Legacy mirror for N-1 clients: rep-id-as-text, exactly the v2
    -- convention. coalesce never stomps a value the v2 RPC already wrote.
    -- (On the join path rep_text is never null: null-rep stories cannot be
    -- candidates — the candidate query joins through the rep.)
    select s.rep_article_id::text into rep_text from public.stories s where s.id = sid;
    update public.articles
       set story_id = sid,
           cluster_id = coalesce(cluster_id, coalesce(rep_text, item_id::text))
     where id = item_id
       and story_id is null;

    -- Recompute counters from actual membership (no blind increments);
    -- greatest() because self-heal delivers joins out of chronological order.
    update public.stories s
       set article_count = m.n,
           source_count = m.ns,
           region_count = m.nr,
           last_article_at = greatest(s.last_article_at, item_ts)
      from (select count(*) as n,
                   count(distinct source_name) as ns,
                   count(distinct source_region) as nr
              from public.articles
             where story_id = sid) m
     where s.id = sid;

    r_article_id := item_id;
    r_story_id := sid;
    r_is_new := was_new;
    return next;
  end loop;
end;
$$;

revoke execute on function public.assign_story_by_embedding(jsonb, text, real, int)
  from public, anon, authenticated;

-- Retention learns about stories: orphan-prune (derived from article
-- retention, same pattern as article_content) — NOT a second time horizon.
create or replace function public.run_retention()
returns text
language plpgsql
set search_path = ''
as $$
declare
  n_articles int;
  n_stories int;
  n_content int;
  n_translations int;
  n_rejects int;
  n_runs int;
  n_cron int;
begin
  delete from public.articles where fetched_at < now() - interval '30 days';
  get diagnostics n_articles = row_count;

  delete from public.stories s
   where not exists (select 1 from public.articles a where a.story_id = s.id);
  get diagnostics n_stories = row_count;

  delete from public.article_content c
   where not exists (select 1 from public.articles a where a.url = c.url);
  get diagnostics n_content = row_count;

  delete from public.article_translations where created_at < now() - interval '30 days';
  get diagnostics n_translations = row_count;

  delete from public.classified_rejects where rejected_at < now() - interval '14 days';
  get diagnostics n_rejects = row_count;

  delete from public.pipeline_runs where finished_at < now() - interval '30 days';
  get diagnostics n_runs = row_count;

  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  return format(
    'articles=%s stories=%s content=%s translations=%s rejects=%s runs=%s cron_details=%s',
    n_articles, n_stories, n_content, n_translations, n_rejects, n_runs, n_cron
  );
end;
$$;

revoke execute on function public.run_retention() from public, anon, authenticated;
