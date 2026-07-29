-- Fixture data for the e2e suite.
--
-- The smoke tests used to run against the LIVE production backend, so a PR
-- turned red when the ingestion pipeline was having a bad morning — and a red
-- CI that might not be your fault is a red CI nobody reads. Everything below is
-- deterministic, so a failure means the change broke something.
--
-- Every timestamp is relative to now(), never a literal: the suite asserts on
-- "Today"/"Yesterday" separators and an "updated Xm ago" readout, which a fixed
-- date would break the moment it aged.
--
-- Only loaded by `supabase db reset` / `supabase start` against the local stack
-- (supabase/config.toml → [db.seed]). It never runs against production.

-- ── Sources ─────────────────────────────────────────────────────────────────
-- The roster the /about page renders, with a spread of health states so the
-- green/amber/red/grey dots all have something to show.
insert into public.sources (id, url, name, region, lang, enabled, last_ok_at, consecutive_failures, affiliation) values
  ('11111111-1111-4111-8111-000000000001', 'https://fixture.test/reuters.xml',  'Reuters',          'US/Western',        'en', true,  now() - interval '20 minutes', 0, null),
  ('11111111-1111-4111-8111-000000000002', 'https://fixture.test/ap.xml',       'AP News',          'US/Western',        'en', true,  now() - interval '25 minutes', 0, null),
  ('11111111-1111-4111-8111-000000000003', 'https://fixture.test/bbc.xml',      'BBC World',        'UK',                'en', true,  now() - interval '30 minutes', 0, 'public'),
  ('11111111-1111-4111-8111-000000000004', 'https://fixture.test/meduza.xml',   'Meduza',           'Russian',           'ru', true,  now() - interval '35 minutes', 0, 'exile'),
  ('11111111-1111-4111-8111-000000000005', 'https://fixture.test/rt.xml',       'RT',               'Russian',           'ru', true,  now() - interval '40 minutes', 0, 'state'),
  ('11111111-1111-4111-8111-000000000006', 'https://fixture.test/irna.xml',     'IRNA',             'Iranian',           'fa', true,  now() - interval '45 minutes', 2, 'state'),
  ('11111111-1111-4111-8111-000000000007', 'https://fixture.test/haaretz.xml',  'Haaretz',          'Israeli',           'he', true,  now() - interval '50 minutes', 0, null),
  ('11111111-1111-4111-8111-000000000008', 'https://fixture.test/aljazeera.xml','Al Jazeera',       'Arab/Gulf',         'ar', true,  now() - interval '55 minutes', 0, null),
  ('11111111-1111-4111-8111-000000000009', 'https://fixture.test/osint.xml',    'Bellingcat',       'Independent/OSINT', 'en', true,  null,                          9, null),
  ('11111111-1111-4111-8111-00000000000a', 'https://fixture.test/retired.xml',  'Retired Feed',     'European',          'de', false, now() - interval '30 days',    0, null)
on conflict (url) do nothing;

-- ── Articles ────────────────────────────────────────────────────────────────
-- 64 rows, comfortably over the suite's "substantial feed" threshold, spread
-- across today and yesterday so a day separator always renders.
--
-- Three hand-built stories carry the behaviour the tests actually inspect:
--   s-strike  4 members, 4 sources, 3 regions, 2 languages — the multi-source
--             card, the in-panel timeline, and the source-swap history check.
--   s-wire    3 members where two share a body_hash — the wire badge, and the
--             independent-source count that must read 2 rather than 3.
--   s-ru      a Russian-language single so the reading-language regression test
--             can always find an "RU" chip instead of falling back.
insert into public.stories (id, created_at, last_article_at, article_count, source_count, region_count) values
  ('22222222-2222-4222-8222-000000000001', now() - interval '3 hours', now() - interval '2 hours', 4, 4, 3),
  ('22222222-2222-4222-8222-000000000002', now() - interval '5 hours', now() - interval '4 hours', 3, 3, 2)
on conflict (id) do nothing;

insert into public.articles
  (id, guid, title, url, summary, published_at, fetched_at, source_name, source_region, source_lang, source_affiliation, feed_url, source_id, story_id, body_hash)
values
  -- s-strike: four independent outlets, three regions, two languages.
  ('33333333-3333-4333-8333-000000000001', 'fx-strike-1', 'Strike reported on northern port facility', 'https://fixture.test/a/strike-1',
   'Multiple explosions were reported near the port overnight, according to local officials.',
   now() - interval '2 hours', now() - interval '110 minutes', 'Reuters', 'US/Western', 'en', null,
   'https://fixture.test/reuters.xml', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000001', null),
  ('33333333-3333-4333-8333-000000000002', 'fx-strike-2', 'Port hit in overnight strike, officials say', 'https://fixture.test/a/strike-2',
   'Officials confirmed damage to port infrastructure following overnight explosions.',
   now() - interval '150 minutes', now() - interval '140 minutes', 'BBC World', 'UK', 'en', 'public',
   'https://fixture.test/bbc.xml', '11111111-1111-4111-8111-000000000003', '22222222-2222-4222-8222-000000000001', null),
  ('33333333-3333-4333-8333-000000000003', 'fx-strike-3', 'حملة جوية على ميناء شمالي', 'https://fixture.test/a/strike-3',
   'أفادت تقارير محلية بوقوع انفجارات قرب الميناء.',
   now() - interval '170 minutes', now() - interval '160 minutes', 'Al Jazeera', 'Arab/Gulf', 'ar', null,
   'https://fixture.test/aljazeera.xml', '11111111-1111-4111-8111-000000000008', '22222222-2222-4222-8222-000000000001', null),
  ('33333333-3333-4333-8333-000000000004', 'fx-strike-4', 'Удар по портовой инфраструктуре на севере', 'https://fixture.test/a/strike-4',
   'Местные власти сообщили о повреждении портовой инфраструктуры.',
   now() - interval '3 hours', now() - interval '175 minutes', 'Meduza', 'Russian', 'ru', 'exile',
   'https://fixture.test/meduza.xml', '11111111-1111-4111-8111-000000000004', '22222222-2222-4222-8222-000000000001', null),

  -- s-wire: two share a body_hash (syndicated), one is original reporting.
  -- Independent-source count must therefore read 2, not 3.
  ('33333333-3333-4333-8333-000000000005', 'fx-wire-1', 'Agency copy: ceasefire talks resume', 'https://fixture.test/a/wire-1',
   'Delegations returned to the table on Tuesday for a fresh round of negotiations over the disputed corridor.',
   now() - interval '5 hours', now() - interval '290 minutes', 'Reuters', 'US/Western', 'en', null,
   'https://fixture.test/reuters.xml', '11111111-1111-4111-8111-000000000001', '22222222-2222-4222-8222-000000000002', 'fixture-shared-wire-hash-0001'),
  ('33333333-3333-4333-8333-000000000006', 'fx-wire-2', 'Agency copy: ceasefire talks resume', 'https://fixture.test/a/wire-2',
   'Delegations returned to the table on Tuesday for a fresh round of negotiations over the disputed corridor.',
   now() - interval '290 minutes', now() - interval '285 minutes', 'AP News', 'US/Western', 'en', null,
   'https://fixture.test/ap.xml', '11111111-1111-4111-8111-000000000002', '22222222-2222-4222-8222-000000000002', 'fixture-shared-wire-hash-0001'),
  ('33333333-3333-4333-8333-000000000007', 'fx-wire-3', 'Original reporting: what the corridor deal would cover', 'https://fixture.test/a/wire-3',
   'A separate account of the negotiations, based on interviews with two people in the room.',
   now() - interval '295 minutes', now() - interval '292 minutes', 'Haaretz', 'Israeli', 'he', null,
   'https://fixture.test/haaretz.xml', '11111111-1111-4111-8111-000000000007', '22222222-2222-4222-8222-000000000002', null),

  -- Russian-language singleton — the reading-language picker regression test
  -- looks for a card carrying an "RU" chip.
  ('33333333-3333-4333-8333-000000000008', 'fx-ru-1', 'Переговоры о безопасности продолжаются', 'https://fixture.test/a/ru-1',
   'Стороны продолжили обсуждение вопросов безопасности в регионе.',
   now() - interval '90 minutes', now() - interval '85 minutes', 'RT', 'Russian', 'ru', 'state',
   'https://fixture.test/rt.xml', '11111111-1111-4111-8111-000000000005', null, null)
on conflict (guid) do nothing;

-- Bulk filler: 56 more singletons spanning today and yesterday, cycling through
-- the roster so the region filter has several buckets to empty and restore.
insert into public.articles
  (guid, title, url, summary, published_at, fetched_at, source_name, source_region, source_lang, source_affiliation, feed_url, source_id)
select
  'fx-bulk-' || i,
  'Fixture story ' || i || ': developments continue in the regional security file',
  'https://fixture.test/a/bulk-' || i,
  'Placeholder summary for fixture article ' || i || ', long enough to render the two-line clamp in the feed card.',
  now() - ((i * 25) || ' minutes')::interval,
  now() - ((i * 25 + 5) || ' minutes')::interval,
  s.name, s.region, s.lang, s.affiliation, s.url, s.id
from generate_series(1, 56) as i
join lateral (
  -- Fixture sources ONLY. 20260611_sources.sql seeds the real 200-feed roster
  -- into the same table, and picking from that would make the filler's regions
  -- depend on whatever the production roster happens to contain — the exact
  -- coupling this fixture exists to remove.
  select * from public.sources
   where url like 'https://fixture.test/%' and enabled
   order by name offset (i % 9) limit 1
) s on true
on conflict (guid) do nothing;

-- ── Trending ────────────────────────────────────────────────────────────────
insert into public.trending (article_id, rank, story_id, selected_at) values
  ('33333333-3333-4333-8333-000000000001', 0, '22222222-2222-4222-8222-000000000001', now() - interval '10 minutes'),
  ('33333333-3333-4333-8333-000000000005', 1, '22222222-2222-4222-8222-000000000002', now() - interval '10 minutes'),
  ('33333333-3333-4333-8333-000000000008', 2, null,                                    now() - interval '10 minutes')
on conflict (article_id) do nothing;

insert into public.trending_log (logged_at, picks) values
  (now() - interval '10 minutes', '[
    {"article_id":"33333333-3333-4333-8333-000000000001","story_id":"22222222-2222-4222-8222-000000000001","rank":0,"title":"Strike reported on northern port facility","source_name":"Reuters","source_region":"US/Western"},
    {"article_id":"33333333-3333-4333-8333-000000000005","story_id":"22222222-2222-4222-8222-000000000002","rank":1,"title":"Agency copy: ceasefire talks resume","source_name":"Reuters","source_region":"US/Western"}
  ]'::jsonb);

-- ── Freshness ───────────────────────────────────────────────────────────────
-- pipeline_status() returns max(finished_at) where error is null, which drives
-- the header's "updated Xm ago" readout and its staleness tiers. Recent, so the
-- suite sees a green/ok state rather than amber.
insert into public.pipeline_runs (started_at, finished_at, error, stats) values
  (now() - interval '12 minutes', now() - interval '10 minutes', null,
   '{"feeds_ok": 9, "inserted": 64, "relevant": 64, "trending": "updated:3"}'::jsonb);
