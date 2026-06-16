-- PR-B: separate ALLEGIANCE from GEOGRAPHY. The region taxonomy answered "where"
-- but conflated "who controls the outlet" — RT and exile outlet Meduza shared a
-- bare 'Russian' badge, and only Iran had a state/independent split. affiliation
-- is curated provenance metadata (same category as the 'wire' badge — human-
-- maintained, no model prose): 'state' (state-controlled/owned), 'public'
-- (public broadcaster w/ editorial charter), 'exile' (diaspora/relocated outlet),
-- null (private/independent/think-tank). Denormalized onto articles so the client
-- renders it from one row. New column + new-client render = deploy-skew-safe.
alter table public.sources add column if not exists affiliation text;
alter table public.articles add column if not exists source_affiliation text;

-- Curated mapping — conservative, only clear cases tagged; editor-reviewable.
-- (Debatable calls left null and flagged in the PR: Al Jazeera = Qatar-funded but
-- editorially distinct; VoA/RFE = US-funded but charter-bound, tagged 'public'.)
update public.sources set affiliation = 'state' where name in (
  'Press TV','IRNA','Tasnim News','Fars News','Mehr News','Tehran Times','ISNA English',
  'ISNA Persian','Iran Daily','IRNA Isfahan','IRNA Khorasan','IRNA Khuzestan','IRNA Kermanshah',
  'IRNA Fars','Mashregh News',
  'TASS','RT','Sputnik','Sputnik World','RIA Novosti',
  'Xinhua','Xinhua Middle East','Global Times','China Daily','CGTN','People''s Daily',
  'KUNA','Qatar News Agency','Bahrain News Agency','Oman News Agency','SANA (Syria)','SABA Yemen Agency',
  'Anadolu Agency','TRT World'
);
update public.sources set affiliation = 'public' where name in (
  'BBC World','BBC World News','Deutsche Welle','DW World','France 24','France 24 World',
  'RFI English','NHK World','NPR World','Voice of America','Radio Free Europe','Radio Farda',
  'Radio Svoboda','Swiss Info','Yonhap','Channel 4 News'
);
update public.sources set affiliation = 'exile' where name in (
  'Iran International','Iran International (FA)','Meduza','The Moscow Times','Novaya Gazeta Europe','iStories'
);

-- Backfill the denormalized column on existing articles (small table post-retention).
update public.articles a
   set source_affiliation = s.affiliation
  from public.sources s
 where a.source_id = s.id
   and a.source_affiliation is distinct from s.affiliation;
