-- The alarm (src/lib/server/pipeline/alerts.ts): a push notification, to
-- browsers that asked for one, when a world-changing event is confirmed.
--
-- push_subscriptions holds a browser's push address and keys, nothing else: no
-- account, no name. It is added by subscribe_alerts from the browser's own
-- switch, removed by unsubscribe_alerts or when the push service says the
-- address is gone. Service-only otherwise.
create table public.push_subscriptions (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  failures integer not null default 0
);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;

-- Every story the alarm asked Jev about, and what came of it: the record of
-- what it woke people for, and what it would have.
create table public.alerts (
  id bigint generated always as identity primary key,
  story_id uuid not null unique,
  created_at timestamptz not null default now(),
  headline text not null,
  p_confirm real not null,
  outlets integer not null,
  regions integer not null,
  -- 'sent', or why not: 'declined' (Jev judged it not world-changing),
  -- 'no_key' (no signing key configured), 'spaced' (another alert went out
  -- within the spacing window).
  status text not null,
  sent integer not null default 0,
  failed integer not null default 0
);
alter table public.alerts enable row level security;
revoke all on table public.alerts from anon, authenticated;

-- Only the browsers' own push services: a subscription is an address the
-- pipeline will POST to, so it may not point anywhere else.
create function public.subscribe_alerts(p_endpoint text, p_p256dh text, p_auth text) returns void
    language plpgsql
    security definer
    set search_path to ''
    as $$
begin
  if p_endpoint is null or length(p_endpoint) > 1000
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/' then
    raise exception 'unsupported push endpoint';
  end if;
  if p_p256dh is null or p_auth is null or length(p_p256dh) > 200 or length(p_auth) > 100 then
    raise exception 'invalid push keys';
  end if;
  if (select count(*) from public.push_subscriptions) >= 100000 then
    raise exception 'alerts are full';
  end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth) values (p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, failures = 0;
end;
$$;

create function public.unsubscribe_alerts(p_endpoint text) returns void
    language sql
    security definer
    set search_path to ''
    as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

revoke all on function public.subscribe_alerts(text, text, text) from public;
revoke all on function public.unsubscribe_alerts(text) from public;
grant execute on function public.subscribe_alerts(text, text, text) to anon, authenticated, service_role;
grant execute on function public.unsubscribe_alerts(text) to anon, authenticated, service_role;
