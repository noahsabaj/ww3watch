\set ON_ERROR_STOP on
-- No report text, contact details or row values are printed by this drill.
do $$
declare r record; n bigint; predicate text; nullable text;
begin
  if (select count(*) from public.articles)<10 then raise exception 'Restored feed is empty'; end if;
  if not exists(select 1 from public.sources) then raise exception 'Missing sources'; end if;
  for r in select c.oid, c.conrelid::regclass child, c.confrelid::regclass parent, c.conkey, c.confkey
    from pg_constraint c join pg_namespace s on s.oid=c.connamespace where c.contype='f' and s.nspname='public'
  loop
    select string_agg(format('p.%I=c.%I',pa.attname,ca.attname),' and '),
      string_agg(format('c.%I is not null',ca.attname),' and ')
    into predicate,nullable from unnest(r.conkey,r.confkey) k(childkey,parentkey)
      join pg_attribute ca on ca.attrelid=r.child and ca.attnum=k.childkey
      join pg_attribute pa on pa.attrelid=r.parent and pa.attnum=k.parentkey;
    execute format('select count(*) from %s c where %s and not exists(select 1 from %s p where %s)',r.child,nullable,r.parent,predicate) into n;
    if n>0 then raise exception 'Restored foreign key relationship invalid'; end if;
  end loop;
  if exists(select 1 from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and not c.relrowsecurity) then raise exception 'Table without RLS'; end if;
  if has_table_privilege('anon','public.visitor_reports','SELECT') or has_table_privilege('authenticated','public.visitor_reports','UPDATE') then raise exception 'Report privileges exposed'; end if;
  if has_function_privilege('anon','public.reserve_ai(text,text,integer,integer)','EXECUTE') then raise exception 'Budget RPC exposed'; end if;
end $$;
select json_build_object('articles',(select count(*) from public.articles),'sources',(select count(*) from public.sources),'stories',(select count(*) from public.stories),'reports',(select count(*) from public.visitor_reports),'relationships','valid','privateAccess','denied') as restore_summary;
