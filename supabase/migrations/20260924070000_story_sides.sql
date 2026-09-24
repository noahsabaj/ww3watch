-- Stories covered from both sides of a rivalry (src/lib/sides.ts), and whether
-- those sides' first reports contradict each other, as Jev judged it
-- (src/lib/server/pipeline/sides.ts). Public: a contradiction is shown as the
-- story's "disputed" tag.
create table public.story_sides (
  story_id uuid primary key references public.stories (id) on delete cascade,
  judged_at timestamptz not null default now(),
  -- 'russia|ukraine', 'iran|west', ...
  sides text not null,
  -- Each side's first report on the story (articles.id): the pair Jev compared.
  -- A new earliest report on either side is a new pair, asked again.
  first_a uuid not null,
  first_b uuid not null,
  p_disputed real
);
alter table public.story_sides enable row level security;
revoke all on table public.story_sides from anon, authenticated;
grant select on table public.story_sides to anon, authenticated;
create policy "Public can read story sides" on public.story_sides for select using (true);
