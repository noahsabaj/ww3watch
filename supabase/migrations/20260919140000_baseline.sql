-- BASELINE — the whole schema as of 2026-09-19, in one file.
--
-- Replaces 38 incremental migrations (2026-06-07 … 2026-09-19). Nine of those
-- shared an 8-digit version ("20260611…"), which current Supabase CLIs refuse
-- ("duplicate key value violates unique constraint schema_migrations_pkey"), and
-- four functions had each been re-pasted in full up to four times. The history is
-- in git (last commit with the old files: see docs/CONVENTIONS.md → Migrations).
--
-- The body is `pg_dump --schema-only --schema=public` of a database built from
-- those 38 files in CI, so it is what they produced — not a rewrite. CI proved
-- the equivalence: types generated from the old chain and from production
-- matched for the whole `public` schema. Hand-written parts are marked HAND.
--
-- From here on: one migration per change, 14-digit version, never edited after
-- it is applied. Functions are changed with a NEW migration that replaces them.

-- ── HAND: roles, extensions, schema usage ───────────────────────────────────
-- Supabase provisions these roles; a plain Postgres (CI's scratch database when
-- it is not the Supabase image, a self-hoster) does not.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
end $$;

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_cron;

grant usage on schema public to anon, authenticated, service_role;

-- ── pg_dump ─────────────────────────────────────────────────────────────────
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
--
-- Name: actor_daily(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.actor_daily(p_days integer DEFAULT 30) RETURNS TABLE(actor text, day date, stories bigint, major bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select x.actor,
         (a.published_at at time zone 'utc')::date as day,
         count(distinct coalesce(a.story_id, a.id)) as stories,
         count(distinct coalesce(a.story_id, a.id)) filter (where a.severity >= 0.55) as major
    from public.articles a
   cross join lateral unnest(a.actors) as x(actor)
   where a.published_at > now() - make_interval(days => least(greatest(p_days, 1), 30))
     and a.published_at <= now()
   group by 1, 2
$$;


--
-- Name: apply_article_signals(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_article_signals(p_items jsonb) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  n integer;
begin
  update public.articles a set
    topic = x.topic,
    severity = x.severity,
    claim = x.claim,
    unverified = x.unverified,
    opinion = x.opinion,
    actors = case when x.actors is null then null
                  else array(select jsonb_array_elements_text(x.actors)) end,
    jev_relevant = x.jev_relevant,
    signals_at = now()
  from jsonb_to_recordset(p_items) as x(
    id uuid, topic text, severity real, claim real, unverified real,
    opinion real, actors jsonb, jev_relevant real
  )
  where a.id = x.id;
  get diagnostics n = row_count;
  return n;
end;
$$;


--
-- Name: assign_story_by_embedding(jsonb, text, real, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_story_by_embedding(p_items jsonb, p_model text, p_threshold real, p_window_hours integer) RETURNS TABLE(r_article_id uuid, r_story_id uuid, r_is_new boolean)
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  item jsonb;
  item_id uuid;
  item_ts timestamptz;
  v extensions.vector(768);
  w interval;
  join_hint uuid;
  avoid_hint uuid;
  floor_sim real;
  best_story uuid;
  best_sim real;
  sid uuid;
  was_new boolean;
begin
  w := make_interval(hours => p_window_hours);

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := (item->>'id')::uuid;
    item_ts := coalesce((item->>'published_at')::timestamptz, now());
    v := (item->>'embedding')::extensions.vector(768);
    join_hint := (item->>'join_story')::uuid;
    avoid_hint := (item->>'avoid_story')::uuid;
    floor_sim := greatest(p_threshold, coalesce((item->>'min_sim')::real, p_threshold));

    insert into public.article_embeddings (article_id, embedding, model)
    values (item_id, v, p_model)
    on conflict (article_id)
      do update set embedding = excluded.embedding, model = excluded.model;

    sid := null;
    -- A judged SAME verdict outranks the number. The story must still exist
    -- (retention may have pruned it between the two RPC calls).
    if join_hint is not null then
      select s.id into sid from public.stories s where s.id = join_hint;
    end if;

    if sid is not null then
      was_new := false;
    else
      -- Nearest story REPRESENTATIVE whose story is ACTIVE within the
      -- item-relative window (see 20260612_story_window.sql), minus the story a
      -- judged DIFFERENT verdict ruled out.
      best_story := null;
      best_sim := null;
      select s.id, 1 - (ae.embedding operator(extensions.<=>) v)
        into best_story, best_sim
        from public.stories s
        join public.articles rep on rep.id = s.rep_article_id
        join public.article_embeddings ae on ae.article_id = rep.id
       where rep.id <> item_id
         and (avoid_hint is null or s.id <> avoid_hint)
         and s.last_article_at between item_ts - w and item_ts + w
         and s.created_at > item_ts - interval '72 hours'
       order by ae.embedding operator(extensions.<=>) v
       limit 1;

      if best_sim is not null and best_sim >= floor_sim then
        sid := best_story;
        was_new := false;
      else
        insert into public.stories (created_at, last_article_at, rep_article_id)
        values (item_ts, item_ts, item_id)
        returning id into sid;
        was_new := true;
      end if;
    end if;

    update public.articles
       set story_id = sid
     where id = item_id
       and story_id is null;

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


--
-- Name: check_rate_limit(text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_rate_limit(p_ip text, p_fn text, p_limit integer) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  cur int;
begin
  insert into public.rate_limits as rl (ip, fn, window_start, count)
  values (p_ip, p_fn, date_trunc('hour', now()), 1)
  on conflict (ip, fn, window_start)
    do update set count = rl.count + 1
  returning count into cur;
  return cur <= p_limit;
end;
$$;


--
-- Name: detach_from_story(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detach_from_story(p_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  touched uuid[];
  n integer;
begin
  select array_agg(distinct a.story_id) into touched
    from public.articles a
    join public.stories s on s.id = a.story_id
   where a.id = any(p_ids) and s.rep_article_id <> a.id;

  update public.articles a
     set story_id = null
    from public.stories s
   where a.id = any(p_ids) and s.id = a.story_id and s.rep_article_id <> a.id;
  get diagnostics n = row_count;

  update public.stories s
     set article_count = m.n, source_count = m.ns, region_count = m.nr
    from (select story_id,
                 count(*) as n,
                 count(distinct source_name) as ns,
                 count(distinct source_region) as nr
            from public.articles
           where story_id = any(touched)
           group by story_id) m
   where s.id = m.story_id;
  return n;
end;
$$;


--
-- Name: existing_guids(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.existing_guids(check_guids text[]) RETURNS TABLE(guid text)
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  select a.guid from public.articles a where a.guid = any(check_guids)
  union
  select r.guid from public.classified_rejects r where r.guid = any(check_guids)
$$;


--
-- Name: nearest_story_candidates(jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.nearest_story_candidates(p_items jsonb, p_window_hours integer) RETURNS TABLE(r_article_id uuid, r_story_id uuid, r_rep_title text, r_sim real)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
declare
  item jsonb;
  item_id uuid;
  item_ts timestamptz;
  v extensions.vector(768);
  w interval;
begin
  w := make_interval(hours => p_window_hours);
  for item in select value from jsonb_array_elements(p_items)
  loop
    item_id := (item->>'id')::uuid;
    item_ts := coalesce((item->>'published_at')::timestamptz, now());
    v := (item->>'embedding')::extensions.vector(768);

    r_article_id := item_id;
    r_story_id := null;
    r_rep_title := null;
    r_sim := null;
    select s.id, rep.title, 1 - (ae.embedding operator(extensions.<=>) v)
      into r_story_id, r_rep_title, r_sim
      from public.stories s
      join public.articles rep on rep.id = s.rep_article_id
      join public.article_embeddings ae on ae.article_id = rep.id
     where rep.id <> item_id
       and s.last_article_at between item_ts - w and item_ts + w
       and s.created_at > item_ts - interval '72 hours'
     order by ae.embedding operator(extensions.<=>) v
     limit 1;
    return next;
  end loop;
end;
$$;


--
-- Name: ops_health(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_health() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'db_size_mb', round((pg_database_size(current_database()) / 1048576.0)::numeric, 1),
    'retention_last_status', (
      select jrd.status from cron.job_run_details jrd
        join cron.job j on j.jobid = jrd.jobid
       where j.jobname = 'ww3watch-retention'
       order by jrd.end_time desc nulls last limit 1),
    'retention_last_at', (
      select jrd.end_time from cron.job_run_details jrd
        join cron.job j on j.jobid = jrd.jobid
       where j.jobname = 'ww3watch-retention'
       order by jrd.end_time desc nulls last limit 1)
  );
$$;


--
-- Name: pipeline_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pipeline_status() RETURNS timestamp with time zone
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select max(finished_at) from public.pipeline_runs where error is null
$$;


--
-- Name: purge_irrelevant_articles(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_irrelevant_articles(p_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  doomed uuid[];
  touched uuid[];
  n integer;
begin
  select array_agg(a.id) into doomed
    from public.articles a
   where a.id = any(p_ids)
     and not exists (select 1 from public.trending t where t.article_id = a.id::text);
  if doomed is null then return 0; end if;

  select array_agg(distinct a.story_id) into touched
    from public.articles a where a.id = any(doomed) and a.story_id is not null;

  insert into public.classified_rejects (guid, title, source_id, lang, reason)
  select a.guid, a.title, a.source_id, a.source_lang, 'jev'
    from public.articles a where a.id = any(doomed)
  on conflict (guid) do nothing;

  delete from public.articles a where a.id = any(doomed);
  get diagnostics n = row_count;

  if touched is not null then
    update public.stories s
       set rep_article_id = (select a.id from public.articles a
                              where a.story_id = s.id
                              order by a.published_at desc nulls last limit 1)
     where s.id = any(touched) and s.rep_article_id is null;
    delete from public.stories s
     where s.id = any(touched)
       and not exists (select 1 from public.articles a where a.story_id = s.id);
    update public.stories s
       set article_count = m.n, source_count = m.ns, region_count = m.nr
      from (select story_id, count(*) as n,
                   count(distinct source_name) as ns,
                   count(distinct source_region) as nr
              from public.articles where story_id = any(touched) group by story_id) m
     where s.id = m.story_id;
  end if;
  return n;
end;
$$;


--
-- Name: reelect_story_reps(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reelect_story_reps(p_story_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  n integer;
begin
  with sized as (
    select a.story_id
      from public.articles a
     where a.story_id = any(p_story_ids)
     group by a.story_id
    having count(*) between 3 and 80
  ), centrality as (
    select a.story_id, a.id as article_id, a.published_at,
           (select avg(1 - (e.embedding operator(extensions.<=>) e2.embedding))
              from public.articles a2
              join public.article_embeddings e2 on e2.article_id = a2.id
             where a2.story_id = a.story_id and a2.id <> a.id) as c
      from public.articles a
      join public.article_embeddings e on e.article_id = a.id
     where a.story_id in (select story_id from sized)
  ), medoid as (
    select distinct on (story_id) story_id, article_id
      from centrality
     where c is not null
     order by story_id, c desc, published_at asc nulls last
  )
  update public.stories s
     set rep_article_id = m.article_id
    from medoid m
   where s.id = m.story_id and s.rep_article_id is distinct from m.article_id;
  get diagnostics n = row_count;
  return n;
end;
$$;


--
-- Name: replace_trending(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_trending(p_rows jsonb, p_log_picks jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  item jsonb;
begin
  -- Clear current trending rows (safe-update requires a WHERE clause).
  delete from public.trending where true;

  -- Insert new trending rows
  if p_rows is not null and jsonb_array_length(p_rows) > 0 then
    for item in select value from jsonb_array_elements(p_rows)
    loop
      insert into public.trending (article_id, story_id, rank, selected_at)
      values (
        item->>'article_id',
        (item->>'story_id')::uuid,
        (item->>'rank')::smallint,
        coalesce((item->>'selected_at')::timestamptz, now())
      );
    end loop;
  end if;

  -- Append to trending_log
  if p_log_picks is not null and jsonb_array_length(p_log_picks) > 0 then
    insert into public.trending_log (picks)
    values (p_log_picks);
  end if;
end;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
    if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog','information_schema') and cmd.schema_name not like 'pg\_toast%' and cmd.schema_name not like 'pg\_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$$;


--
-- Name: run_retention(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_retention() RETURNS text
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  n_articles int;
  n_stories int;
  n_content int;
  n_translations int;
  n_rejects int;
  n_runs int;
  n_trending_log int;
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

  delete from public.trending_log where logged_at < now() - interval '30 days';
  get diagnostics n_trending_log = row_count;

  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics n_cron = row_count;

  return format(
    'articles=%s stories=%s content=%s translations=%s rejects=%s runs=%s trending_log=%s cron_details=%s',
    n_articles, n_stories, n_content, n_translations, n_rejects, n_runs, n_trending_log, n_cron
  );
end;
$$;


--
-- Name: source_yield(integer, integer, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.source_yield(p_days integer, p_min_items integer, p_max_pct real) RETURNS TABLE(r_name text, r_accepted bigint, r_rejected bigint, r_pct real)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with acc as (
    select source_id, count(*) n from public.articles
     where fetched_at > now() - make_interval(days => p_days) group by 1
  ), rej as (
    select source_id, count(*) n from public.classified_rejects
     where rejected_at > now() - make_interval(days => p_days)
       and reason in ('jev', 'head', 'llm') group by 1
  )
  select s.name, coalesce(acc.n, 0), coalesce(rej.n, 0),
         (100.0 * coalesce(acc.n, 0) / (coalesce(acc.n, 0) + coalesce(rej.n, 0)))::real
    from public.sources s
    left join acc on acc.source_id = s.id
    left join rej on rej.source_id = s.id
   where s.enabled
     and coalesce(acc.n, 0) + coalesce(rej.n, 0) >= p_min_items
     and 100.0 * coalesce(acc.n, 0) / (coalesce(acc.n, 0) + coalesce(rej.n, 0)) <= p_max_pct
   order by 4 asc, 3 desc
$$;


--
-- Name: story_join_sims(timestamp with time zone, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.story_join_sims(p_since timestamp with time zone, p_below real) RETURNS TABLE(r_article_id uuid, r_title text, r_rep_title text, r_sim real)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select a.id, a.title, rep.title,
         (1 - (ae.embedding operator(extensions.<=>) re.embedding))::real
    from public.articles a
    join public.stories s on s.id = a.story_id
    join public.articles rep on rep.id = s.rep_article_id
    join public.article_embeddings ae on ae.article_id = a.id
    join public.article_embeddings re on re.article_id = rep.id
   where a.id <> rep.id
     and a.fetched_at > p_since
     and (1 - (ae.embedding operator(extensions.<=>) re.embedding)) < p_below
   order by a.id
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: article_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_content (
    url text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    byline text,
    content text NOT NULL,
    site_name text,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: article_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_embeddings (
    article_id uuid NOT NULL,
    embedding extensions.vector(768) NOT NULL,
    model text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: article_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.article_translations (
    input_hash text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_lang text DEFAULT 'en'::text NOT NULL
);


--
-- Name: articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guid text NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    summary text,
    published_at timestamp with time zone,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    source_name text NOT NULL,
    source_region text NOT NULL,
    source_lang text DEFAULT 'en'::text NOT NULL,
    feed_url text NOT NULL,
    body_hash text,
    source_id uuid,
    story_id uuid,
    source_affiliation text,
    topic text,
    severity real,
    claim real,
    unverified real,
    opinion real,
    actors text[],
    jev_relevant real,
    signals_at timestamp with time zone
);


--
-- Name: classified_rejects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classified_rejects (
    guid text NOT NULL,
    rejected_at timestamp with time zone DEFAULT now() NOT NULL,
    title text,
    source_id uuid,
    lang text,
    reason text DEFAULT 'jev'::text NOT NULL,
    CONSTRAINT classified_rejects_reason_check CHECK ((reason = ANY (ARRAY['llm'::text, 'stale'::text, 'head'::text, 'jev'::text])))
);


--
-- Name: COLUMN classified_rejects.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.classified_rejects.reason IS 'Who said no: jev (TypeSafe Jev verdict), head (local relevance head, never trained on), stale (written off unjudged, too old to display), llm (historical: the retired LLM classifier).';


--
-- Name: pipeline_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_runs (
    id bigint NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone DEFAULT now() NOT NULL,
    error text,
    stats jsonb
);


--
-- Name: pipeline_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_runs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pipeline_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    ip text NOT NULL,
    fn text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer DEFAULT 1 NOT NULL
);


--
-- Name: sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    url text NOT NULL,
    name text NOT NULL,
    region text NOT NULL,
    lang text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_ok_at timestamp with time zone,
    last_via text,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    last_error_kind text,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    affiliation text
);


--
-- Name: stories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_article_at timestamp with time zone DEFAULT now() NOT NULL,
    article_count integer DEFAULT 1 NOT NULL,
    source_count integer DEFAULT 1 NOT NULL,
    region_count integer DEFAULT 1 NOT NULL,
    rep_article_id uuid
);


--
-- Name: trending; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trending (
    article_id text NOT NULL,
    rank smallint NOT NULL,
    selected_at timestamp with time zone DEFAULT now() NOT NULL,
    story_id uuid
);


--
-- Name: trending_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trending_log (
    id bigint NOT NULL,
    logged_at timestamp with time zone DEFAULT now() NOT NULL,
    picks jsonb NOT NULL
);


--
-- Name: trending_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.trending_log ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.trending_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: article_content article_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_content
    ADD CONSTRAINT article_content_pkey PRIMARY KEY (url);


--
-- Name: article_embeddings article_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_embeddings
    ADD CONSTRAINT article_embeddings_pkey PRIMARY KEY (article_id);


--
-- Name: article_translations article_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_translations
    ADD CONSTRAINT article_translations_pkey PRIMARY KEY (input_hash);


--
-- Name: articles articles_guid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_guid_key UNIQUE (guid);


--
-- Name: articles articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_pkey PRIMARY KEY (id);


--
-- Name: classified_rejects classified_rejects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classified_rejects
    ADD CONSTRAINT classified_rejects_pkey PRIMARY KEY (guid);


--
-- Name: pipeline_runs pipeline_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_runs
    ADD CONSTRAINT pipeline_runs_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (ip, fn, window_start);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: sources sources_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_url_key UNIQUE (url);


--
-- Name: stories stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_pkey PRIMARY KEY (id);


--
-- Name: trending_log trending_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trending_log
    ADD CONSTRAINT trending_log_pkey PRIMARY KEY (id);


--
-- Name: trending trending_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trending
    ADD CONSTRAINT trending_pkey PRIMARY KEY (article_id);


--
-- Name: articles_fetched_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_fetched_at_idx ON public.articles USING btree (fetched_at DESC);


--
-- Name: articles_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_published_at_idx ON public.articles USING btree (published_at DESC);


--
-- Name: articles_signals_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_signals_pending_idx ON public.articles USING btree (fetched_at DESC) WHERE (signals_at IS NULL);


--
-- Name: articles_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_source_id_idx ON public.articles USING btree (source_id);


--
-- Name: articles_source_lang_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_source_lang_idx ON public.articles USING btree (source_lang);


--
-- Name: articles_source_region_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_source_region_idx ON public.articles USING btree (source_region);


--
-- Name: articles_story_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_story_id_idx ON public.articles USING btree (story_id);


--
-- Name: articles_url_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX articles_url_idx ON public.articles USING btree (url);


--
-- Name: classified_rejects_reason_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classified_rejects_reason_idx ON public.classified_rejects USING btree (reason);


--
-- Name: classified_rejects_rejected_at_reason_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classified_rejects_rejected_at_reason_idx ON public.classified_rejects USING btree (rejected_at, reason);


--
-- Name: classified_rejects_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classified_rejects_source_id_idx ON public.classified_rejects USING btree (source_id);


--
-- Name: stories_rep_article_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stories_rep_article_id_idx ON public.stories USING btree (rep_article_id);


--
-- Name: trending_log_logged_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trending_log_logged_at_idx ON public.trending_log USING btree (logged_at DESC);


--
-- Name: trending_story_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trending_story_id_idx ON public.trending USING btree (story_id);


--
-- Name: article_embeddings article_embeddings_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.article_embeddings
    ADD CONSTRAINT article_embeddings_article_id_fkey FOREIGN KEY (article_id) REFERENCES public.articles(id) ON DELETE CASCADE;


--
-- Name: articles articles_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE SET NULL;


--
-- Name: articles articles_story_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.stories(id) ON DELETE SET NULL;


--
-- Name: classified_rejects classified_rejects_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classified_rejects
    ADD CONSTRAINT classified_rejects_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sources(id) ON DELETE SET NULL;


--
-- Name: stories stories_rep_article_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stories
    ADD CONSTRAINT stories_rep_article_id_fkey FOREIGN KEY (rep_article_id) REFERENCES public.articles(id) ON DELETE SET NULL;


--
-- Name: articles Public can read articles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read articles" ON public.articles FOR SELECT USING (true);


--
-- Name: sources Public can read sources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read sources" ON public.sources FOR SELECT USING (true);


--
-- Name: trending Public can read trending; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read trending" ON public.trending FOR SELECT USING (true);


--
-- Name: trending_log Public can read trending_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public can read trending_log" ON public.trending_log FOR SELECT USING (true);


--
-- Name: article_content; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_content ENABLE ROW LEVEL SECURITY;

--
-- Name: article_embeddings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: article_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.article_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: articles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

--
-- Name: classified_rejects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.classified_rejects ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

--
-- Name: stories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;

--
-- Name: trending; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trending ENABLE ROW LEVEL SECURITY;

--
-- Name: trending_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trending_log ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION actor_daily(p_days integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.actor_daily(p_days integer) TO anon;
GRANT ALL ON FUNCTION public.actor_daily(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.actor_daily(p_days integer) TO service_role;


--
-- Name: FUNCTION apply_article_signals(p_items jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_article_signals(p_items jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_article_signals(p_items jsonb) TO service_role;


--
-- Name: FUNCTION assign_story_by_embedding(p_items jsonb, p_model text, p_threshold real, p_window_hours integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.assign_story_by_embedding(p_items jsonb, p_model text, p_threshold real, p_window_hours integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.assign_story_by_embedding(p_items jsonb, p_model text, p_threshold real, p_window_hours integer) TO service_role;


--
-- Name: FUNCTION check_rate_limit(p_ip text, p_fn text, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_rate_limit(p_ip text, p_fn text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_rate_limit(p_ip text, p_fn text, p_limit integer) TO service_role;


--
-- Name: FUNCTION detach_from_story(p_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.detach_from_story(p_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.detach_from_story(p_ids uuid[]) TO service_role;


--
-- Name: FUNCTION existing_guids(check_guids text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.existing_guids(check_guids text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.existing_guids(check_guids text[]) TO service_role;


--
-- Name: FUNCTION nearest_story_candidates(p_items jsonb, p_window_hours integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.nearest_story_candidates(p_items jsonb, p_window_hours integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.nearest_story_candidates(p_items jsonb, p_window_hours integer) TO service_role;


--
-- Name: FUNCTION ops_health(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ops_health() FROM PUBLIC;
GRANT ALL ON FUNCTION public.ops_health() TO service_role;


--
-- Name: FUNCTION pipeline_status(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.pipeline_status() TO anon;
GRANT ALL ON FUNCTION public.pipeline_status() TO authenticated;
GRANT ALL ON FUNCTION public.pipeline_status() TO service_role;


--
-- Name: FUNCTION purge_irrelevant_articles(p_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.purge_irrelevant_articles(p_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_irrelevant_articles(p_ids uuid[]) TO service_role;


--
-- Name: FUNCTION reelect_story_reps(p_story_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reelect_story_reps(p_story_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reelect_story_reps(p_story_ids uuid[]) TO service_role;


--
-- Name: FUNCTION replace_trending(p_rows jsonb, p_log_picks jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.replace_trending(p_rows jsonb, p_log_picks jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.replace_trending(p_rows jsonb, p_log_picks jsonb) TO service_role;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION run_retention(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.run_retention() FROM PUBLIC;
GRANT ALL ON FUNCTION public.run_retention() TO service_role;


--
-- Name: FUNCTION source_yield(p_days integer, p_min_items integer, p_max_pct real); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.source_yield(p_days integer, p_min_items integer, p_max_pct real) FROM PUBLIC;
GRANT ALL ON FUNCTION public.source_yield(p_days integer, p_min_items integer, p_max_pct real) TO service_role;


--
-- Name: FUNCTION story_join_sims(p_since timestamp with time zone, p_below real); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.story_join_sims(p_since timestamp with time zone, p_below real) FROM PUBLIC;
GRANT ALL ON FUNCTION public.story_join_sims(p_since timestamp with time zone, p_below real) TO service_role;


--
-- Name: TABLE article_content; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.article_content TO service_role;


--
-- Name: TABLE article_embeddings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.article_embeddings TO service_role;


--
-- Name: TABLE article_translations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.article_translations TO service_role;


--
-- Name: TABLE articles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.articles TO anon;
GRANT ALL ON TABLE public.articles TO authenticated;
GRANT ALL ON TABLE public.articles TO service_role;


--
-- Name: TABLE classified_rejects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.classified_rejects TO service_role;


--
-- Name: TABLE pipeline_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pipeline_runs TO service_role;


--
-- Name: SEQUENCE pipeline_runs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.pipeline_runs_id_seq TO anon;
GRANT ALL ON SEQUENCE public.pipeline_runs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.pipeline_runs_id_seq TO service_role;


--
-- Name: TABLE rate_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rate_limits TO service_role;


--
-- Name: TABLE sources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sources TO anon;
GRANT ALL ON TABLE public.sources TO authenticated;
GRANT ALL ON TABLE public.sources TO service_role;


--
-- Name: TABLE stories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stories TO service_role;


--
-- Name: TABLE trending; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trending TO anon;
GRANT ALL ON TABLE public.trending TO authenticated;
GRANT ALL ON TABLE public.trending TO service_role;


--
-- Name: TABLE trending_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.trending_log TO anon;
GRANT ALL ON TABLE public.trending_log TO authenticated;
GRANT ALL ON TABLE public.trending_log TO service_role;


--
-- Name: SEQUENCE trending_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.trending_log_id_seq TO anon;
GRANT ALL ON SEQUENCE public.trending_log_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.trending_log_id_seq TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


-- ── HAND: the auto-RLS safety net ───────────────────────────────────────────
-- Event triggers are database-level, so a schema-scoped dump cannot carry this
-- one — and it matters more than it looks: any new public table gets RLS enabled
-- automatically, so a table added without an explicit `enable row level
-- security` is still protected. (rls_auto_enable() itself is in the dump above,
-- verbatim from the live project including its `search_path = pg_catalog`.)
-- CREATE EVENT TRIGGER needs superuser. Hosted Supabase and the local stack both
-- run migrations as one, but a self-hosted deploy might not — warn rather than
-- fail, since every table here also enables RLS explicitly.
do $$ begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    begin
      create event trigger ensure_rls on ddl_command_end execute function public.rls_auto_enable();
    exception when insufficient_privilege then
      raise warning 'could not create the ensure_rls event trigger (needs superuser) — new tables will NOT get RLS automatically; enable it explicitly on each';
    end;
  end if;
end $$;

-- ── HAND: realtime publication membership ───────────────────────────────────
-- Not part of a schema-scoped dump. The feed subscribes to INSERT/UPDATE on
-- articles and to every change on trending.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'articles') then
    alter publication supabase_realtime add table public.articles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trending') then
    alter publication supabase_realtime add table public.trending;
  end if;
end $$;

-- ── HAND: daily retention ───────────────────────────────────────────────────
-- cron.job is data, not schema. cron.schedule upserts by job name.
select cron.schedule('ww3watch-retention', '17 4 * * *', $$select public.run_retention()$$);
