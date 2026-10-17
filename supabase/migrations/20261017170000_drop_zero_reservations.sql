-- A reservation that settles at $0 is deleted instead of kept, so a provider
-- outage cannot fill the database with rows that record no spend.
--
-- Measured 2026-10-17: ai_reservations was 818 MB (3.66M rows) and the
-- database 1,256 MB against the pipeline's 450 MB ceiling. Every Jev call
-- failed unbilled from 2026-10-10 to 2026-10-16 (jev.ts UNBILLED settles them
-- at zero). Each run retried its ~1,300 deferred judgments and ~1,200 signals,
-- ~2,500 reservations a run, ~700k a day, and run_private_retention keeps a
-- settled row for 7 days. 3,628,402 of the rows had charged_usd = 0.
--
-- A $0 row carries nothing: its charge is already refunded from ai_months
-- below, and reserve_ai only reads unsettled rows. Paid rows stay as before,
-- the record of what each attempt cost.

create or replace function public.settle_ai(p_id uuid, p_input_tokens integer default null, p_output_tokens integer default null) returns void
language plpgsql set search_path = '' as $$
declare r public.ai_reservations; actual numeric;
begin
  select * into r from public.ai_reservations where id=p_id for update;
  if not found or r.settled then return; end if;
  -- An uncertain attempt retains its reservation; a reported usage settles it once.
  actual := case when p_input_tokens>=0 and p_output_tokens>=0 then (p_input_tokens*r.input_rate+p_output_tokens*r.output_rate)/1000000 else r.charged_usd end;
  update public.ai_months set charged_usd=greatest(0,charged_usd+actual-r.charged_usd) where service=r.service and month=r.month;
  if actual = 0 then
    delete from public.ai_reservations where id=p_id;
  else
    update public.ai_reservations set charged_usd=actual, settled=true, lease_until=now() where id=p_id;
  end if;
end $$;
revoke all on function public.settle_ai(uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.settle_ai(uuid,integer,integer) to service_role;

delete from public.ai_reservations where settled and charged_usd = 0;
