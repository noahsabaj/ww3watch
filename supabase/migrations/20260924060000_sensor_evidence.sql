-- Evidence from sensors, set against strike stories (src/lib/server/pipeline/evidence.ts).
--
-- sensor_events keeps a week of public readings from the areas the site covers:
-- NASA FIRMS satellite fire detections, USGS seismic events and IODA internet
-- outages. story_places records where a story's event happened, as Jev chose it
-- from place names found in its reports. story_evidence is what a reader sees:
-- at most one reading of each kind per story, only one that is near in place and
-- time and new (a fire where nothing burned in the days before).

create table public.sensor_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('fire', 'quake', 'outage')),
  source text not null,
  ext_id text not null,
  at timestamptz not null,
  lat real,
  lon real,
  -- Fires: a 0.02-degree square (~2 km), to tell a new fire from a gas flare or
  -- a steelworks that shows up every night.
  cell text,
  -- Fire: radiative power in MW. Quake: magnitude. Outage: IODA's score.
  value real,
  place text,
  detail jsonb,
  unique (source, ext_id)
);
create index sensor_events_kind_at on public.sensor_events (kind, at);
create index sensor_events_cell on public.sensor_events (cell, at) where kind = 'fire';
alter table public.sensor_events enable row level security;
revoke all on table public.sensor_events from anon, authenticated;

-- When each source was last read, so a 5-minute pipeline reads FIRMS hourly.
create table public.sensor_fetches (
  source text primary key,
  fetched_at timestamptz not null
);
alter table public.sensor_fetches enable row level security;
revoke all on table public.sensor_fetches from anon, authenticated;

create table public.story_places (
  story_id uuid primary key references public.stories (id) on delete cascade,
  located_at timestamptz not null default now(),
  -- GeoNames id and name; null when the reports name no single place.
  place_id integer,
  name text,
  country text,
  lat real,
  lon real,
  first_report_at timestamptz not null,
  -- Jev: could the event start a fire, cut power or internet, or shake the ground?
  p_fire real,
  p_outage real,
  p_blast real
);
create index story_places_first_report on public.story_places (first_report_at) where place_id is not null;
alter table public.story_places enable row level security;
revoke all on table public.story_places from anon, authenticated;

create table public.story_evidence (
  story_id uuid not null references public.stories (id) on delete cascade,
  kind text not null check (kind in ('fire', 'quake', 'outage')),
  found_at timestamptz not null default now(),
  -- When the sensor saw it.
  at timestamptz not null,
  place text not null,
  distance_km real,
  value real,
  -- hours_from_first (signed), detections, url.
  detail jsonb,
  primary key (story_id, kind)
);
alter table public.story_evidence enable row level security;
revoke all on table public.story_evidence from anon, authenticated;
grant select on table public.story_evidence to anon, authenticated;
create policy "Public can read story evidence" on public.story_evidence for select using (true);
