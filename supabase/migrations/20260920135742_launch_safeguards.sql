-- Private operational state. All writes go through service-role callers.
create table public.visitor_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text not null check (category in ('problem','correction','source','privacy')),
  message text not null check (length(message) between 10 and 4000),
  email text check (length(email) <= 254),
  article_id uuid references public.articles(id) on delete set null,
  fingerprint text not null,
  status text not null default 'new' check (status in ('new','reviewed','closed'))
);
create index visitor_reports_created on public.visitor_reports(created_at);
create index visitor_reports_fingerprint on public.visitor_reports(fingerprint, created_at);
create table public.ai_budgets (
  service text primary key check (service in ('classification','translation')),
  monthly_usd numeric not null check (monthly_usd > 0),
  model text,
  input_per_million numeric check (input_per_million >= 0),
  output_per_million numeric check (output_per_million >= 0),
  pricing_verified_at timestamptz,
  max_concurrent integer not null check (max_concurrent between 1 and 32)
);
insert into public.ai_budgets(service, monthly_usd, max_concurrent) values
 ('classification',15,16), ('translation',3,3);
create table public.ai_months (
  service text references public.ai_budgets(service), month date,
  charged_usd numeric not null default 0 check (charged_usd >= 0),
  opening_verified_at timestamptz,
  primary key(service,month)
);
create table public.ai_reservations (
  id uuid primary key default gen_random_uuid(),
  service text not null, month date not null,
  charged_usd numeric not null check (charged_usd >= 0),
  input_rate numeric not null, output_rate numeric not null,
  created_at timestamptz not null default now(),
  lease_until timestamptz not null default now() + interval '2 minutes',
  settled boolean not null default false,
  foreign key(service,month) references public.ai_months(service,month)
);
create index ai_reservations_active on public.ai_reservations(service,lease_until) where not settled;
create table public.ops_events (
  name text primary key, occurred_at timestamptz not null default now(), details jsonb not null default '{}'
);
alter table public.visitor_reports enable row level security;
alter table public.ai_budgets enable row level security;
alter table public.ai_months enable row level security;
alter table public.ai_reservations enable row level security;
alter table public.ops_events enable row level security;
revoke all on public.visitor_reports, public.ai_budgets, public.ai_months, public.ai_reservations, public.ops_events from public, anon, authenticated;
grant all on public.visitor_reports, public.ai_budgets, public.ai_months, public.ai_reservations, public.ops_events to service_role;

create function public.reserve_ai(p_service text, p_model text, p_input_tokens integer, p_output_tokens integer) returns jsonb
language plpgsql set search_path = '' as $$
declare b public.ai_budgets; m public.ai_months; estimate numeric; rid uuid; current_month date := date_trunc('month', now() at time zone 'UTC')::date;
begin
  if p_input_tokens < 0 or p_output_tokens < 0 or p_input_tokens is null or p_output_tokens is null then raise exception 'invalid_tokens'; end if;
  select * into b from public.ai_budgets where service=p_service for update;
  if b.model is distinct from p_model or b.model is null or b.pricing_verified_at is null or b.input_per_million is null or b.output_per_million is null then
    return jsonb_build_object('error','pricing_unverified');
  end if;
  insert into public.ai_months(service,month,opening_verified_at) values(p_service,current_month,
    case when current_month > (select min(month) from public.ai_months where service=p_service and opening_verified_at is not null) then now() else null end)
    on conflict do nothing;
  select * into m from public.ai_months where service=p_service and month=current_month for update;
  if m.opening_verified_at is null then return jsonb_build_object('error','opening_usage_unverified'); end if;
  estimate := (p_input_tokens*b.input_per_million+p_output_tokens*b.output_per_million)/1000000;
  if m.charged_usd+estimate>b.monthly_usd then return jsonb_build_object('error','budget_exhausted'); end if;
  if (select count(*) from public.ai_reservations where service=p_service and not settled and lease_until>now()) >= b.max_concurrent then
    return jsonb_build_object('error','busy');
  end if;
  update public.ai_months set charged_usd=charged_usd+estimate where service=p_service and month=current_month;
  insert into public.ai_reservations(service,month,charged_usd,input_rate,output_rate) values(p_service,current_month,estimate,b.input_per_million,b.output_per_million) returning id into rid;
  return jsonb_build_object('id',rid,'reserved_usd',estimate);
end $$;

create function public.settle_ai(p_id uuid, p_input_tokens integer default null, p_output_tokens integer default null) returns void
language plpgsql set search_path = '' as $$
declare r public.ai_reservations; actual numeric;
begin
  select * into r from public.ai_reservations where id=p_id for update;
  if not found or r.settled then return; end if;
  -- An uncertain attempt retains its reservation; a reported usage settles it once.
  actual := case when p_input_tokens>=0 and p_output_tokens>=0 then (p_input_tokens*r.input_rate+p_output_tokens*r.output_rate)/1000000 else r.charged_usd end;
  update public.ai_months set charged_usd=greatest(0,charged_usd+actual-r.charged_usd) where service=r.service and month=r.month;
  update public.ai_reservations set charged_usd=actual, settled=true, lease_until=now() where id=p_id;
end $$;

create function public.submit_report(p_category text, p_message text, p_email text, p_article uuid, p_fingerprint text) returns boolean
language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(20890320);
  if exists(select 1 from public.visitor_reports where fingerprint=p_fingerprint and created_at>now()-interval '1 day') then return true; end if;
  if (select count(*) from public.visitor_reports where created_at >= date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') >= 100 then return false; end if;
  insert into public.visitor_reports(category,message,email,article_id,fingerprint) values(p_category,p_message,p_email,p_article,p_fingerprint);
  return true;
end $$;

create function public.run_private_retention() returns void language plpgsql set search_path = '' as $$
begin
  delete from public.rate_limits where window_start < now()-interval '48 hours';
  delete from public.visitor_reports where created_at < now()-interval '90 days';
  delete from public.ai_reservations where created_at < now()-interval '90 days';
end $$;
revoke all on function public.reserve_ai(text,text,integer,integer), public.settle_ai(uuid,integer,integer), public.submit_report(text,text,text,uuid,text), public.run_private_retention() from public,anon,authenticated;
grant execute on function public.reserve_ai(text,text,integer,integer), public.settle_ai(uuid,integer,integer), public.submit_report(text,text,text,uuid,text), public.run_private_retention() to service_role;
-- Hourly cleanup adds at most one hour to the stated live-store retention.
select cron.schedule('private-retention','17 * * * *','select public.run_private_retention()');
delete from public.rate_limits where window_start < now()-interval '48 hours';
