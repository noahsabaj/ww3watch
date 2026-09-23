-- Story merge, repaired.
--
-- story_merge_candidates timed out on every run from 2026-09-22 (57014 at the
-- 8s statement timeout; 10.6s with ~1,500 active stories): each of the 2.2M
-- pairs read both embeddings out of TOAST again. And before that, the runs
-- re-asked Jev about the same 60 closest pairs every time (5,760 judgments a
-- day for ~50 merges), because nothing remembered a "different".
--
-- 1. Each representative's vector is read once: l2_normalize returns a fresh
--    in-line value, the CTE is materialized, and a pair costs one inner
--    product (cosine, since both sides are unit length). ~2s at 1,500 stories.
-- 2. story_merge_judged remembers every "different" and "unsure", keyed on the
--    two representatives' article ids. A pair is asked about once; when a story
--    elects a new representative it has changed, and the pair is new.

create table public.story_merge_judged (
  rep_a      uuid        not null,
  rep_b      uuid        not null,
  verdict    text        not null check (verdict in ('different', 'unsure')),
  judged_at  timestamptz not null default now(),
  primary key (rep_a, rep_b),
  check (rep_a < rep_b)
);
-- The pipeline forgets pairs older than the merge window (clustering.ts).
create index story_merge_judged_judged_at on public.story_merge_judged (judged_at);

-- Service-only, like verdicts: RLS on, zero policies, no anon grant.
alter table public.story_merge_judged enable row level security;
revoke all on public.story_merge_judged from anon, authenticated;

drop function public.story_merge_candidates(int, real, int);
create function public.story_merge_candidates(p_hours int, p_min_sim real, p_limit int)
returns table (
  r_a uuid, r_b uuid, r_a_rep uuid, r_b_rep uuid,
  r_a_title text, r_b_title text, r_a_count int, r_b_count int, r_sim real
)
language sql
stable
set search_path = ''
set work_mem = '32MB'
as $$
  with active as materialized (
    select row_number() over () as n, s.id, s.rep_article_id as rep, s.article_count, rep.title,
           extensions.l2_normalize(e.embedding) as v
      from public.stories s
      join public.articles rep on rep.id = s.rep_article_id
      join public.article_embeddings e on e.article_id = rep.id
     where s.last_article_at > now() - make_interval(hours => p_hours)
  )
  select a.id, p.id, a.rep, p.rep, a.title, p.title, a.article_count, p.article_count, p.sim
    from active a
    -- offset 0 keeps the subquery from being flattened, so the n filter halves
    -- the pairs before any vector arithmetic.
    cross join lateral (
      select b.id, b.rep, b.title, b.article_count,
             (-(a.v operator(extensions.<#>) b.v))::real as sim
        from active b
       where b.n > a.n
      offset 0
    ) p
   where p.sim >= p_min_sim
     and not exists (
       select 1 from public.story_merge_judged j
        where j.rep_a = least(a.rep, p.rep) and j.rep_b = greatest(a.rep, p.rep))
   order by p.sim desc
   limit p_limit
$$;
revoke execute on function public.story_merge_candidates(int, real, int) from public, anon, authenticated;

-- Database linter (2026-09-23): cover the three unindexed foreign keys, drop
-- the index nothing uses. classified_rejects_source_id_idx is also reported
-- unused but covers that table's foreign key, so it stays.
create index ai_reservations_service_month on public.ai_reservations (service, month);
create index verdicts_source_id_idx on public.verdicts (source_id);
create index visitor_reports_article_id on public.visitor_reports (article_id);
-- trending holds three rows; merge_stories' repoint scans it either way.
drop index public.trending_story_id_idx;
